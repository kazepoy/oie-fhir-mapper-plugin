FROM curlimages/curl:8.21.0 AS download
ARG HADES_VERSION=2.0.282
RUN curl --fail --silent --show-error --location --max-time 300 \
      "https://github.com/wardle/hades/releases/download/v${HADES_VERSION}/hades-${HADES_VERSION}.jar" \
      --output /tmp/hades.jar \
    && echo '2a069fd40ccdb9e64aae6d7360b3f1727108323b7f9db236f2d00593fdbb0bfe  /tmp/hades.jar' | sha256sum -c -

FROM eclipse-temurin:21-jre-alpine
COPY --from=download /tmp/hades.jar /opt/hades/hades.jar
USER 10001:10001
EXPOSE 8500
ENTRYPOINT ["java", "-jar", "/opt/hades/hades.jar"]
CMD ["serve", "/term-server", "--port", "8500", "--bind-address", "0.0.0.0"]
