FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# psycopg[binary] and bcrypt both publish manylinux aarch64 wheels, so the Pi
# needs no compiler. If a future pin ever loses its wheel, add:
#   RUN apt-get update && apt-get install -y --no-install-recommends \
#       build-essential libpq-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY . .

# Run as a non-root user; the container never needs to write to its own files.
RUN chmod +x entrypoint.sh \
    && adduser --disabled-password --gecos "" --uid 10001 muney \
    && chown -R muney:muney /app
USER muney

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

ENTRYPOINT ["./entrypoint.sh"]
