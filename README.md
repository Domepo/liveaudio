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

  <h3 align="center">LiveAudio – Open-Source Alternative zu LiveVoice</h3>

  <p align="center">
    Produktionsnahes Audio-Streaming-System für Live-Broadcasts mit WebRTC.
    <br />
    <a href="https://domepo.github.io/liveaudio/"><strong>Zur Dokumentation »</strong></a>
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
  <summary>Inhaltsverzeichnis</summary>
  <ol>
    <li><a href="#projektueberblick">Projektüberblick</a></li>
    <li><a href="#technologien">Technologien</a></li>
    <li>
      <a href="#schnellstart">Schnellstart</a>
      <ul>
        <li><a href="#voraussetzungen">Voraussetzungen</a></li>
        <li><a href="#installation-lokal">Installation (Lokale Entwicklung)</a></li>
        <li><a href="#installation-docker">Installation (Hosting mit Docker)</a></li>
      </ul>
    </li>
    <li><a href="#nutzung">Nutzung</a></li>
    <li><a href="#tests">Tests</a></li>
    <li><a href="#fahrplan">Fahrplan</a></li>
    <li><a href="#mitwirken">Mitwirken</a></li>
    <li><a href="#lizenz">Lizenz</a></li>
    <li><a href="#kontakt">Kontakt</a></li>
    <li><a href="#danksagungen">Danksagungen</a></li>
  </ol>
</details>

<a id="projektueberblick"></a>
## Projektüberblick

[![LiveAudio Demo][product-screenshot]](docs/assets/readme_gif.gif)

LiveAudio ist ein Audio-only Realtime-System für Live-Übertragungen mit klarer Trennung zwischen Admin-Steuerung, Media-Pipeline und Listener-Client.

Warum LiveAudio:
- Niedrige Latenz über WebRTC (mediasoup)
- Browserbasierte Admin- und Listener-UI
- Join-Flow via 6-stelligem Token + QR
- Rollen- und Rechtekonzept (`ADMIN`, `BROADCASTER`, `VIEWER`)
- Docker-fähiger Betrieb mit Postgres

<p align="right">(<a href="#readme-top">nach oben</a>)</p>

<a id="technologien"></a>
## Technologien

- Node.js + TypeScript
- Express + Socket.IO
- mediasoup
- Svelte + Tailwind CSS
- Prisma (`SQLite` lokal, `Postgres` im Betrieb)
- Vitest + Supertest + Playwright

<p align="right">(<a href="#readme-top">nach oben</a>)</p>

<a id="schnellstart"></a>
## Schnellstart

<a id="voraussetzungen"></a>
### Voraussetzungen

- Node.js `20+`
- npm `10+`
- Docker + Docker Compose (für Container-Betrieb)

<a id="installation-lokal"></a>
### Installation (Lokale Entwicklung)

```sh
git clone https://github.com/Domepo/liveaudio.git
cd liveaudio
npm install
npm run dev
```

Startet:
- Web: `http://localhost:5173`
- API-Health: `http://localhost:3001/health`
- Media-Health: `http://localhost:4000/health`

<a id="installation-docker"></a>
### Installation (Hosting mit Docker)

```sh
docker pull ghcr.io/domepo/liveaudio:latest
docker compose -f docker-compose.hosting.yml up -d
```

Die App-Container bauen nativ für die jeweilige Architektur (`amd64`/`arm64`).

Vollständige Hosting-Anleitung:
- [Schnellstart](./docs/getting-started.md)
- [Bereitstellung](./docs/deployment.md)

<p align="right">(<a href="#readme-top">nach oben</a>)</p>

<a id="nutzung"></a>
## Nutzung

Standard-MVP-Flow:
1. Im Admin-Bereich einloggen.
2. Session erstellen.
3. Channel(s) anlegen.
4. Broadcast starten.
5. Listener mit Token/QR beitreten und Channel hören.

LAN-Nutzung (Handy):
1. Rechner + Handy ins gleiche Netzwerk.
2. `npm run dev` starten.
3. Im Handy `http://<RECHNER-IP>:5173` öffnen.

Benötigte Ports:
- `5173/tcp` (Web)
- `3001/tcp` (API)
- `4000/tcp` (Media intern/health)
- `40000-42000/udp` (WebRTC)

<p align="right">(<a href="#readme-top">nach oben</a>)</p>

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
- [Testleitfaden](./docs/testing.md)
- [Fehlerbehebung](./docs/troubleshooting.md)

<p align="right">(<a href="#readme-top">nach oben</a>)</p>

<a id="fahrplan"></a>
## Fahrplan

- [x] Rollen-/Auth-Flow mit Passwortwechselpflicht
- [x] Session-/Channel-Management im Admin
- [x] Listener Join per Token/QR
- [x] Docker-Bereitstellung + Doku
- [ ] Erweiterte Performance-/Lasttests im CI
- [ ] Weitere Observability-/Operations-Hooks

Siehe auch: [Offene Issues](https://github.com/Domepo/liveaudio/issues)

<p align="right">(<a href="#readme-top">nach oben</a>)</p>

<a id="mitwirken"></a>
## Mitwirken

PRs und Verbesserungsvorschläge sind willkommen.

Typischer Ablauf:
1. Fork erstellen
2. Branch anlegen (`feature/<name>`)
3. Änderungen committen
4. PR öffnen

<p align="right">(<a href="#readme-top">nach oben</a>)</p>

<a id="lizenz"></a>
## Lizenz

Dieses Projekt steht unter der MIT-Lizenz. Siehe [LICENSE](./LICENSE).

<p align="right">(<a href="#readme-top">nach oben</a>)</p>

<a id="kontakt"></a>
## Kontakt

Projekt:
- [https://github.com/Domepo/liveaudio](https://github.com/Domepo/liveaudio)

Dokumentation:
- [https://domepo.github.io/liveaudio/](https://domepo.github.io/liveaudio/)

<p align="right">(<a href="#readme-top">nach oben</a>)</p>

<a id="danksagungen"></a>
## Danksagungen

- [mediasoup](https://mediasoup.org/)
- [Prisma](https://www.prisma.io/)
- [Svelte](https://svelte.dev/)
- [Playwright](https://playwright.dev/)
- [VitePress](https://vitepress.dev/)

<p align="right">(<a href="#readme-top">nach oben</a>)</p>

[contributors-shield]: https://img.shields.io/github/contributors/Domepo/liveaudio.svg?style=for-the-badge
[contributors-url]: https://github.com/Domepo/liveaudio/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/Domepo/liveaudio.svg?style=for-the-badge
[forks-url]: https://github.com/Domepo/liveaudio/network/members
[stars-shield]: https://img.shields.io/github/stars/Domepo/liveaudio.svg?style=for-the-badge
[stars-url]: https://github.com/Domepo/liveaudio/stargazers
[issues-shield]: https://img.shields.io/github/issues/Domepo/liveaudio.svg?style=for-the-badge
[issues-url]: https://github.com/Domepo/liveaudio/issues
[product-screenshot]: docs/assets/readme_gif.gif
[docs-url]: https://domepo.github.io/liveaudio/
