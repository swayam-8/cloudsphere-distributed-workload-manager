FROM python:3.12-slim
COPY wheels/ /wheels/
COPY requirements.txt /wheels/requirements.txt
RUN pip install --no-cache-dir --no-index --find-links=/wheels --require-hashes -r /wheels/requirements.txt && rm -rf /wheels
COPY --chmod=0555 run.py analytics.py /app/
USER 65534:65534
ENTRYPOINT ["python", "-u", "/app/run.py"]
