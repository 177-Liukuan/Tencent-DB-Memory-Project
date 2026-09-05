FROM python:3.13-slim AS runtime
WORKDIR /app
COPY app ./app
EXPOSE 8080
CMD ["python", "-m", "app.server"]
