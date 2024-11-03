FROM python:3.11-alpine

WORKDIR /ml

COPY worker.py requirements.txt /ml/

RUN pip install --no-cache-dir --upgrade -r /ml/requirements.txt

ENTRYPOINT [ "python3", "-u", "worker.py" ]