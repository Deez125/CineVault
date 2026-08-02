#!/bin/sh
set -e

# Which job is this container? See the Dockerfile header.
#
# Migrations run before the WEB app serves anything, and only there. Running them from the
# worker as well would mean two containers racing to apply the same migration on a deploy,
# and Postgres would resolve that with a lock rather than a merge — one of them would sit
# waiting or fail outright.

case "${1:-web}" in
  web)
    echo "[entrypoint] applying migrations"
    node dist/migrate.js

    echo "[entrypoint] starting web on ${HOSTNAME}:${PORT}"
    exec node server.js
    ;;

  worker)
    # Deliberately does NOT migrate. It waits for the schema the web container applies; if it
    # starts first against an old schema, its next loop picks up the new one.
    echo "[entrypoint] starting worker"
    exec node dist/worker.js
    ;;

  migrate)
    exec node dist/migrate.js
    ;;

  *)
    # Anything else is run verbatim, so `docker run … sh` still works for a look around.
    exec "$@"
    ;;
esac
