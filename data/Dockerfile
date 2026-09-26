FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt requirements-test.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-test.txt

COPY localio/ localio/
COPY tests/ tests/

# seed_data/ and output/ are bind-mounted by docker-compose.yml
CMD ["python", "-m", "localio"]
