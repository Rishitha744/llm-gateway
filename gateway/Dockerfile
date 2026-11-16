# Build context is the repository root (see docker-compose.yml).
FROM python:3.14-slim

WORKDIR /srv

COPY gateway/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY common ./common
COPY gateway/app ./app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
