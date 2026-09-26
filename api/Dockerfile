FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FASTEMBED_CACHE=/models

WORKDIR /app

COPY requirements.txt requirements-test.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-test.txt

# Bake the embedding model (about 70 MB) into the image, so the container
# starts without a download and runs offline.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/models')"

COPY localio_api/ localio_api/
COPY tests/ tests/

# The pipeline's output is bind-mounted read-only at /srv/localio-data.
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"
CMD ["uvicorn", "localio_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
