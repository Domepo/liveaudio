<a id="readme-top"></a>

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]

<br />
<div align="center">
  <a href="https://github.com/Domepo/liveaudio">
    <img src="docs/assets/icon.png" alt="LiveAudio Logo" width="96" height="96">
  </a>

  <h3 align="center">LiveAudio</h3>

  <p align="center">
    Produktionsnahes Audio-Streaming-System fuer Live-Broadcasts mit WebRTC.
    <br />
    <a href="https://domepo.github.io/liveaudio/"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/Domepo/liveaudio">Repository</a>
    &middot;
    <a href="https://domepo.github.io/liveaudio/">Doku</a>
    &middot;
    <a href="https://github.com/Domepo/liveaudio/issues">Issues</a>
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#built-with">Built With</a></li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation-local-development">Installation (Local Development)</a></li>
        <li><a href="#installation-hosting-via-docker">Installation (Hosting via Docker)</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#tests">Tests</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

[![LiveAudio Dashboard][product-screenshot]](docs/assets/dashboard.png)

LiveAudio ist ein Audio-only Realtime-System fuer Live-Uebertragungen mit klarer Trennung zwischen Admin-Steuerung, Media-Pipeline und Listener-Client.

Warum LiveAudio:
- Niedrige Latenz ueber WebRTC (mediasoup)
- Browserbasierte Admin- und Listener-UI
- Join-Flow via 6-stelligem Token + QR
- Rollen- und Rechtekonzept (`ADMIN`, `BROADCASTER`, `VIEWER`)
- Docker-faehiger Betrieb mit Postgres

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Built With

- Node.js + TypeScript
- Express + Socket.IO
- mediasoup
- Svelte + Tailwind CSS
- Prisma (`SQLite` lokal, `Postgres` Deployment)
- Vitest + Supertest + Playwright

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

- Node.js `20+`
- npm `10+`
- Docker + Docker Compose (fuer Container-Deployment)

### Installation (Local Development)

```sh
git clone https://github.com/Domepo/liveaudio.git
cd liveaudio
npm install
npm run dev
```

Startet:
- Web: `http://localhost:5173`
- API Health: `http://localhost:3001/health`
- Media Health: `http://localhost:4000/health`

### Installation (Hosting via Docker)

```sh
docker pull ghcr.io/domepo/liveaudio:latest
docker compose -f docker-compose.hosting.yml up -d
```

Vollstaendige Hosting-Anleitung:
- [Getting Started](./docs/getting-started.md)
- [Deployment](./docs/deployment.md)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

Standard-MVP-Flow:
1. Im Admin-Bereich einloggen.
2. Session erstellen.
3. Channel(s) anlegen.
4. Broadcast starten.
5. Listener mit Token/QR joinen und Channel hoeren.

LAN-Nutzung (Handy):
1. Rechner + Handy ins gleiche Netzwerk.
2. `npm run dev` starten.
3. Im Handy `http://<RECHNER-IP>:5173` oeffnen.

Benoetigte Ports:
- `5173/tcp` (Web)
- `3001/tcp` (API)
- `4000/tcp` (Media intern/health)
- `40000-42000/udp` (WebRTC)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Tests

```sh
# Unit + Integration
npm run test:unit

# E2E
npm run test:e2e

# Alles
npm test
```

Playwright Browser-Setup (einmalig lokal):
```sh
npx playwright install chromium
```

Weitere Infos:
- [Testing Guide](./docs/testing.md)
- [Troubleshooting](./docs/troubleshooting.md)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Rollen-/Auth-Flow mit Passwortwechselpflicht
- [x] Session-/Channel-Management im Admin
- [x] Listener Join per Token/QR
- [x] Docker-Deployment + Docs
- [ ] Erweiterte Performance-/Lasttests im CI
- [ ] Weitere Observability-/Operations-Hooks

Siehe auch: [Open Issues](https://github.com/Domepo/liveaudio/issues)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

PRs und Verbesserungsvorschlaege sind willkommen.

Typischer Ablauf:
1. Fork erstellen
2. Branch anlegen (`feature/<name>`)
3. Aenderungen committen
4. PR oeffnen

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Aktuell ist keine OSS-Lizenzdatei im Repository hinterlegt.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Projekt:
- [https://github.com/Domepo/liveaudio](https://github.com/Domepo/liveaudio)

Dokumentation:
- [https://domepo.github.io/liveaudio/](https://domepo.github.io/liveaudio/)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

- [mediasoup](https://mediasoup.org/)
- [Prisma](https://www.prisma.io/)
- [Svelte](https://svelte.dev/)
- [Playwright](https://playwright.dev/)
- [VitePress](https://vitepress.dev/)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[contributors-shield]: https://img.shields.io/github/contributors/Domepo/liveaudio.svg?style=for-the-badge
[contributors-url]: https://github.com/Domepo/liveaudio/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/Domepo/liveaudio.svg?style=for-the-badge
[forks-url]: https://github.com/Domepo/liveaudio/network/members
[stars-shield]: https://img.shields.io/github/stars/Domepo/liveaudio.svg?style=for-the-badge
[stars-url]: https://github.com/Domepo/liveaudio/stargazers
[issues-shield]: https://img.shields.io/github/issues/Domepo/liveaudio.svg?style=for-the-badge
[issues-url]: https://github.com/Domepo/liveaudio/issues
[product-screenshot]: docs/assets/dashboard.png
