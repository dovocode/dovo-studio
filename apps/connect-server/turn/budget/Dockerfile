FROM python:3.15-alpine3.24
RUN apk add --no-cache nftables
WORKDIR /app
COPY guard.py .
CMD ["python3", "-u", "guard.py"]
