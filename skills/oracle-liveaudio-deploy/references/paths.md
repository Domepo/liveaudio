# Oracle Deploy Paths

Defaultwerte im Deploy-Script:

- ORACLE_HOST: `freeserver`
- LOCAL_SOURCE_DIR: `/Users/dominik/Documents/liveaudio`
- REMOTE_COMPOSE_DIR: `/home/freeserver/compose/stack-apps`

Branch-/Stack-Mapping:

- `main`/`master` -> `prod`
  - REMOTE_REPO_DIR: `/home/freeserver/compose/stack-apps/github/liveaudio`
  - Services: `livevoice-web livevoice-api livevoice-media`
- `dev`/`develop` -> `dev`
  - REMOTE_REPO_DIR: `/home/freeserver/compose/stack-apps/github/liveaudio-dev`
  - Services: `livevoice-dev-web livevoice-dev-api livevoice-dev-media`
