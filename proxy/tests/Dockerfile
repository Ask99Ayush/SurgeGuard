# syntax=docker/dockerfile:1
FROM python:3.12.8-slim
ENV PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTEST_ADDOPTS="-p no:cacheprovider"
WORKDIR /tests
RUN pip install httpx==0.28.1 PyJWT==2.10.1 pytest==8.3.4
COPY test_proxy.py .
RUN useradd --system --uid 10001 tester
USER tester
CMD ["pytest", "-q", "test_proxy.py"]
