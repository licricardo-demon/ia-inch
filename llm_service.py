import os
import json
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class Option(BaseModel):
    text: str = Field(description="Texto de la opción de respuesta")
    is_correct: bool = Field(description="True si es la opción correcta, False si es incorrecta")

class Question(BaseModel):
    type: str = Field(description="'multiple_choice' o 'open_ended'")
    topic: str = Field(description="Tema o concepto específico que evalúa esta pregunta (ej: 'Ciclo celular', 'Fotosíntesis', 'Segunda Ley de Newton')")
    question: str = Field(description="El enunciado claro y directo de la pregunta")
    options: Optional[List[Option]] = Field(default=None, description="Exactamente 4 opciones si es multiple_choice (1 correcta, 3 incorrectas)")
    ideal_answer: Optional[str] = Field(default=None, description="Respuesta ideal concisa y precisa basada en los documentos (solo para open_ended)")
    explanation: str = Field(description="Mini-retroalimentación educativa explicando por qué la respuesta correcta es esa y el concepto clave para repasar en caso de error")

class Quiz(BaseModel):
    questions: List[Question] = Field(description="Lista de preguntas de alta calidad")

class Evaluation(BaseModel):
    is_correct: bool = Field(description="True si la respuesta del usuario capta correctamente los conceptos esenciales, False si está equivocada o incompleta.")
    feedback: str = Field(description="Mini-retroalimentación constructiva, amable y directa.")

class LLMService:
    def __init__(self):
        # Inicializa cliente oficial de Gemini
        self.client = genai.Client()
        # Lista priorizada de modelos ultra-rápidos con fallback automático
        self.models_priority = [
            "gemini-flash-lite-latest",
            "gemini-3.1-flash-lite",
            "gemini-flash-latest"
        ]

    def _generate_with_fallback(self, contents, schema, temperature=0.2):
        errors = []
        for model in self.models_priority:
            try:
                response = self.client.models.generate_content(
                    model=model,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=schema,
                        temperature=temperature
                    ),
                )
                if response and response.text:
                    return json.loads(response.text)
            except Exception as e:
                errors.append(f"{model}: {str(e)}")
                continue
        raise Exception(f"No fue posible generar con ningún modelo disponible: {'; '.join(errors)}")

    def generate_quiz_from_files(self, files_info: List[Dict[str, str]], num_closed: int = 5, num_open: int = 2) -> dict:
        # Sube todos los archivos a la File API de Gemini
        uploaded_files = []
        for f in files_info:
            up = self.client.files.upload(file=f['path'], config={'mime_type': f['mime_type']})
            uploaded_files.append(up)
        
        total_questions = num_closed + num_open

        prompt = f"""
Actúa como un profesor universitario experto de clase mundial y creador de exámenes de alto impacto.
Analiza con precisión quirúrgica el material adjunto ({len(uploaded_files)} documentos de estudio) y formula un cuestionario interactivo integral que cubra y conecte los temas y conceptos más relevantes de todos los archivos proporcionados.

DIRECTRICES DE CONTENIDO:
1. Las preguntas deben fundamentarse RIGUROSAMENTE en el contenido de los documentos adjuntos.
2. Cada pregunta DEBE incluir:
   - 'topic': El subtema o concepto evaluado (1 a 3 palabras clave).
   - 'explanation': Una mini-retroalimentación educativa (1 a 2 oraciones) clara y contundente que explique la razón de la respuesta correcta y el concepto a recordar.

DISTRIBUCIÓN EXACTA DE PREGUNTAS (ESTRICTO):
- Preguntas de opción múltiple cerradas ('multiple_choice'): Genera EXACTAMENTE {num_closed} preguntas. Cada una con 4 opciones plausibles donde solo 1 sea correcta.
- Preguntas abiertas de desarrollo ('open_ended'): Genera EXACTAMENTE {num_open} preguntas. Cada una con su 'ideal_answer' clara y concisa extraída de los textos originales.
- TOTAL OBLIGATORIO: Genera EXACTAMENTE {total_questions} preguntas en total ({num_closed} cerradas + {num_open} abiertas). Ni más ni menos.
"""
        contents = [*uploaded_files, prompt]
        return self._generate_with_fallback(
            contents=contents,
            schema=Quiz,
            temperature=0.2
        )

    def generate_quiz_from_file(self, file_path: str, mime_type: str, num_closed: int = 5, num_open: int = 2) -> dict:
        return self.generate_quiz_from_files([{'path': file_path, 'mime_type': mime_type}], num_closed=num_closed, num_open=num_open)

    def evaluate_answer(self, question: str, ideal_answer: str, user_answer: str) -> dict:
        prompt = f"""
Actúa como un profesor pedagógico, justo y alentador.

PREGUNTA: {question}
RESPUESTA IDEAL: {ideal_answer}
RESPUESTA DEL ESTUDIANTE: {user_answer}

EVALUACIÓN:
- Sé flexible con la redacción: Si el estudiante demuestra que comprende la idea central y los conceptos esenciales, márcala como CORRECTA (is_correct: true).
- Si omite el núcleo de la idea o es errónea, márcala como INCORRECTA (is_correct: false).
- En 'feedback', da una mini-retroalimentación breve (máximo 2 oraciones), destacando lo acertado o puntualizando qué detalle faltó según la respuesta ideal.
"""
        return self._generate_with_fallback(
            contents=prompt,
            schema=Evaluation,
            temperature=0.1
        )
