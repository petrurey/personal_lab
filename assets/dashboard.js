"use strict";

const search = document.getElementById("resource-search");
const cards = [...document.querySelectorAll("[data-resource]")];
const status = document.getElementById("search-status");

search.addEventListener("input", () => {
  const words = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  for (const card of cards) {
    card.hidden = !words.every(word => card.dataset.search.includes(word));
  }
  for (const category of document.querySelectorAll(".category")) {
    category.querySelector(".empty-message").hidden = Boolean(category.querySelector("[data-resource]:not([hidden])"));
  }
  const count = cards.filter(card => !card.hidden).length;
  status.textContent = `${count} ${count === 1 ? "resource" : "resources"} found.`;
});

document.addEventListener("keydown", event => {
  if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest("input,textarea,select,[contenteditable]")) {
    event.preventDefault();
    search.focus();
  }
});
