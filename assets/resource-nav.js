"use strict";

{
  const host = document.createElement("personal-lab-navigation");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host{position:fixed;bottom:16px;left:16px;z-index:1000}
      nav{display:flex;gap:3px;align-items:center;padding:5px;border:1px solid #c9d6c6;border-radius:30px;background:#fff;box-shadow:0 4px 20px #0002;font:12px/1.5 "Segoe UI",sans-serif}
      a{color:#204b3c;text-decoration:none;padding:7px 10px;border-radius:22px}
      a:first-child{background:#204b3c;color:#e1f4ad;font-weight:600}
      a:hover{background:#e8f0df;color:#204b3c}
      a:focus-visible{outline:3px solid #477f46;outline-offset:3px}
      @media print{:host{display:none}}
      @media(max-width:420px){:host{bottom:8px;left:8px}a{padding:6px 8px}nav{font-size:11px}}
    </style>
    <nav aria-label="Personal Lab"><a href="../index.html">Personal Lab</a><a href="../index.html#plans">Plans</a><a href="../index.html#labs">Labs</a><a href="../index.html#info">Info</a></nav>`;
  document.body.append(host);
}
