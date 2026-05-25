FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (build-essential needed for some python packages if compiled)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt ./backend/

# Install dependencies
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy backend app source code
COPY . ./backend/

# Expose port
EXPOSE 8000

# Run FastAPI app
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
