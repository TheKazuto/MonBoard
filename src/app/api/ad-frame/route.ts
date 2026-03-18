// src/app/api/ad-frame/route.ts
//
// Serve o HTML do banner AdsTerra como uma página isolada.
// Carregado via <iframe> no AdBanner — garante que o script invoke.js
// executa em contexto HTML puro (sem React, sem Next.js), com
// document.currentScript funcionando normalmente.

import { NextResponse } from 'next/server'

const AD_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</head>
<body>
  <script async="async" data-cfasync="false" src="https://pl28909561.effectivegatecpm.com/ff4f26cf6832320f8139de3639dc511c/invoke.js"></script>
  <div id="container-ff4f26cf6832320f8139de3639dc511c"></div>
</body>
</html>`

export async function GET() {
  return new NextResponse(AD_HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Sem CSP nesta rota — o iframe é same-origin, não third-party
      'Cache-Control': 'no-store',
    },
  })
}
