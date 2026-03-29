import type { ElectrobunConfig } from "electrobun"

export default {
  app: {
    name: "Digital Employee",
    identifier: "com.digitalemployee.app",
    version: "0.0.1",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "electronbun/index.ts",
    },
    copy: {
      dist: "views/main",
    },
    win: {
      icon: "build/icon.ico",
      bundleCEF: false,
    },
    buildFolder: "build",
    artifactFolder: "artifacts",
  },
  // scripts: {
  //   preBuild: "./scripts/pre-build.ts",
  // },
  release: {
    baseUrl: process.env.RELEASE_BASE_URL || "",
  },
} satisfies ElectrobunConfig
