import os
import json
import uuid
import tempfile
from typing import Optional, List
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()
from llm_service import LLMService

app = FastAPI(title="IA-inch by richi")

try:
    llm_service = LLMService()
except Exception as e:
    print(f"Advertencia: No se pudo inicializar LLMService. Detalle: {e}")
    llm_service = None

app.mount("/static", StaticFiles(directory="static"), name="static")

DB_FILE = "db.json"
USERS_FILE = "users.json"

def load_users():
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE, "r") as f:
            try:
                return json.load(f)
            except:
                return {}
    return {}

def save_users(users_data):
    with open(USERS_FILE, "w") as f:
        json.dump(users_data, f, indent=2)

def load_db():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, "r") as f:
            try:
                data = json.load(f)
                changed = False
                for q_id, q in data.items():
                    if "user_id" not in q:
                        q["user_id"] = "ricardo@icloud.com"
                        changed = True
                if changed:
                    save_db(data)
                return data
            except:
                return {}
    return {}

def save_db(db_data):
    with open(DB_FILE, "w") as f:
        json.dump(db_data, f, indent=2)

class AuthRequest(BaseModel):
    email: str
    name: Optional[str] = None
    passcode: Optional[str] = None

PROTECTED_ACCOUNTS = {
    "dani@icloud.com": "2211",
    "ricardo@icloud.com": "2211"
}

@app.post("/api/auth/login")
async def login_or_register(req: AuthRequest):
    email = req.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="El correo de iCloud o Apple ID es obligatorio.")
    
    if "@" not in email:
        email = f"{email}@icloud.com"

    # Verificar contraseña para cuentas protegidas
    if email in PROTECTED_ACCOUNTS:
        expected = PROTECTED_ACCOUNTS[email]
        if not req.passcode or req.passcode.strip() != expected:
            raise HTTPException(status_code=401, detail="Código de acceso incorrecto para esta cuenta protegida.")
        
    users = load_users()
    name = req.name.strip() if req.name and req.name.strip() else None
    
    if email in users:
        user = users[email]
        if name:
            user["name"] = name
            users[email] = user
            save_users(users)
    else:
        default_name = name or email.split("@")[0].capitalize()
        user = {
            "email": email,
            "name": default_name,
            "created_at": datetime.now().isoformat()
        }
        users[email] = user
        save_users(users)
        
    return {
        "success": True,
        "user": user
    }

@app.get("/", response_class=HTMLResponse)
async def read_index():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/api/quizzes")
async def get_quizzes(user_email: Optional[str] = None):
    db = load_db()
    summary = []
    normalized_email = user_email.strip().lower() if user_email else None
    
    for q_id, q_data in db.items():
        q_user = q_data.get("user_id", "ricardo@icloud.com").lower()
        if normalized_email and q_user != normalized_email:
            continue
            
        summary.append({
            "id": q_id,
            "name": q_data.get("name", "Examen sin título"),
            "date": q_data.get("date", ""),
            "num_questions": len(q_data.get("questions", [])),
            "user_id": q_user
        })
    summary.sort(key=lambda x: x["date"], reverse=True)
    return summary

@app.get("/api/quizzes/{quiz_id}")
async def get_quiz(quiz_id: str):
    db = load_db()
    if quiz_id not in db:
        raise HTTPException(status_code=404, detail="Examen no encontrado")
    return db[quiz_id]

@app.delete("/api/quizzes/{quiz_id}")
async def delete_quiz(quiz_id: str, user_email: Optional[str] = None):
    db = load_db()
    if quiz_id in db:
        if user_email:
            q_user = db[quiz_id].get("user_id", "").lower()
            if q_user and q_user != user_email.strip().lower():
                raise HTTPException(status_code=403, detail="No tienes permiso para eliminar este examen")
        del db[quiz_id]
        save_db(db)
        return {"success": True}
    raise HTTPException(status_code=404, detail="Examen no encontrado")

@app.post("/api/quizzes")
async def create_quiz(
    files: List[UploadFile] = File(default=[]),
    file: Optional[UploadFile] = File(default=None),
    quiz_name: str = Form("Mi Examen"),
    user_email: str = Form("ricardo@icloud.com"),
    num_closed: Optional[int] = Form(None),
    num_open: Optional[int] = Form(None),
    num_questions: Optional[int] = Form(None)
):
    if not llm_service:
        raise HTTPException(status_code=500, detail="Servicio de IA no configurado. Verifica tu API Key.")
    
    # Recolectar todos los archivos subidos
    all_files = list(files) if files else []
    if file and file not in all_files:
        all_files.append(file)
        
    if not all_files:
        raise HTTPException(status_code=400, detail="Debes subir al menos un documento para generar el examen.")

    try:
        # Resolver cantidad de preguntas cerradas y abiertas (máximo 50)
        if num_closed is None and num_open is None:
            total = max(3, min(50, int(num_questions or 10)))
            c = max(1, total - 2)
            o = total - c
        else:
            c = max(0, min(50, int(num_closed or 0)))
            o = max(0, min(50, int(num_open or 0)))
            if c + o < 1:
                c = 6
                o = 2
            if c + o > 50:
                scale = 50.0 / (c + o)
                c = int(round(c * scale))
                o = 50 - c

        temp_paths = []
        files_info = []

        try:
            for uf in all_files:
                file_ext = os.path.splitext(uf.filename)[1] if uf.filename else ""
                with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
                    content = await uf.read()
                    tmp.write(content)
                    tmp_path = tmp.name
                    temp_paths.append(tmp_path)
                    
                    mime = uf.content_type or "application/octet-stream"
                    files_info.append({
                        'path': tmp_path,
                        'mime_type': mime,
                        'name': uf.filename or "documento"
                    })

            quiz_data = llm_service.generate_quiz_from_files(files_info, num_closed=c, num_open=o)
        finally:
            for p in temp_paths:
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except:
                        pass
            
        # Guardar en base de datos local
        db = load_db()
        quiz_id = str(uuid.uuid4())
        
        norm_user = user_email.strip().lower() if user_email else "ricardo@icloud.com"
        if "@" not in norm_user:
            norm_user = f"{norm_user}@icloud.com"

        new_quiz = {
            "id": quiz_id,
            "user_id": norm_user,
            "name": quiz_name.strip() or "Examen Multidocumento",
            "date": datetime.now().isoformat(),
            "questions": quiz_data.get("questions", []),
            "documents_count": len(all_files)
        }
        
        db[quiz_id] = new_quiz
        save_db(db)
        
        return new_quiz
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al generar el examen: {str(e)}")

class EvaluationRequest(BaseModel):
    question: str
    ideal_answer: str
    user_answer: str

@app.post("/api/evaluate")
async def evaluate_answer(req: EvaluationRequest):
    if not llm_service:
        raise HTTPException(status_code=500, detail="Servicio de IA no configurado.")
    try:
        evaluation = llm_service.evaluate_answer(req.question, req.ideal_answer, req.user_answer)
        return evaluation
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error evaluando la respuesta: {str(e)}")
