FROM python:3.11-slim

# rasterio's wheel bundles GDAL but links against the system expat.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR \
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=.tif

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY build_catchments.py .

# data/localio (for the loader and aggregation) and seed_data/ are mounted
# by docker-compose.yml, so the tool reads the seed exactly as the pipeline does.
CMD ["python", "build_catchments.py"]
