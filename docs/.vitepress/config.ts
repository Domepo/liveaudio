const config = {
  title: "LiveAudio Docs",
  description: "Technische Dokumentation f\u00fcr Entwicklung, Betrieb und Deployment von LiveAudio.",
  base: process.env.GITHUB_ACTIONS ? "/liveaudio/" : "/",
  lang: "de-DE",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    search: {
      provider: "local"
    },
    nav: [
      { text: "Start", link: "/" },
      { text: "Getting Started", link: "/getting-started" },
      { text: "Architektur", link: "/architecture" },
      { text: "Deployment", link: "/deployment" },
      { text: "Security", link: "/security" },
      { text: "Testing", link: "/testing" },
      { text: "Troubleshooting", link: "/troubleshooting" }
    ],
    sidebar: [
      {
        text: "Grundlagen",
        items: [
          { text: "\u00dcbersicht", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
          { text: "Entwicklung", link: "/development" }
        ]
      },
      {
        text: "System",
        items: [
          { text: "Architektur", link: "/architecture" },
          { text: "Konfiguration", link: "/configuration" },
          { text: "API \u00dcbersicht", link: "/api-overview" }
        ]
      },
      {
        text: "Betrieb",
        items: [
          { text: "Deployment", link: "/deployment" },
          { text: "Operations Runbook", link: "/operations" },
          { text: "Security", link: "/security" },
          { text: "Testing", link: "/testing" },
          { text: "Troubleshooting", link: "/troubleshooting" }
        ]
      }
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/Domepo/liveaudio" }]
  }
};

export default config;
