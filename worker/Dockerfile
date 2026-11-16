# Build context is the repository root (see docker-compose.yml).
FROM python:3.14-slim

WORKDIR /srv

COPY worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY common ./common
COPY worker/worker.py .

CMD ["python", "worker.py"]
