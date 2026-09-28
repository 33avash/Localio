FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY localio/ localio/

# seed_data/ and output/ are bind-mounted by docker-compose.yml
CMD ["python", "-m", "localio"]
