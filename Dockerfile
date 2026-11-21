FROM python:3.12-slim
WORKDIR /app
COPY companion/ /app/companion/
ENV PYTHONUNBUFFERED=1 PORT=3000 HOST=0.0.0.0
EXPOSE 3000
CMD ["python", "-m", "companion.server"]
