FROM denoland/deno:1.28.2

EXPOSE 8000
WORKDIR /app
USER deno

COPY deps.ts .
COPY ../protocol ../protocol
# the line above fails, Docker can't import outside the working dir
RUN deno cache deps.ts

ADD . .
RUN deno cache main.ts

CMD ["run", "--allow-net", "--allow-read", "--allow-env", "main.ts"]
