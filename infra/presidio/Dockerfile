# Presidio analyzer for Sidekik: English + German spaCy models and the AP recognizers.
# Base pinned by digest (presidio-analyzer "latest" as of 2026-10-03); bump deliberately.
#   docker build -t sidekik-presidio-analyzer infra/presidio
FROM mcr.microsoft.com/presidio-analyzer@sha256:286e3fa7f3a7426e775e8564fe1870f1ba8f999d3ab8bbb8cc46a44355d9d6e9

USER root
COPY analyzer.yaml nlp.yaml recognizers.yaml /app/sidekik/
ENV ANALYZER_CONF_FILE=/app/sidekik/analyzer.yaml \
    NLP_CONF_FILE=/app/sidekik/nlp.yaml \
    RECOGNIZER_REGISTRY_CONF_FILE=/app/sidekik/recognizers.yaml
# Bake the models in at build time (de_core_news_md is not in the base image).
RUN python install_nlp_models.py --conf_file ${NLP_CONF_FILE} \
    && chown -R 1001:1001 /app/sidekik
USER 1001
