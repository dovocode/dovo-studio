FROM python:3.13-alpine3.21
RUN apk add --no-cache nftables
WORKDIR /app
COPY guard.py .
CMD ["python3", "-u", "guard.py"]
