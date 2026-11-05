"use strict";

const storageKey = "personal-lab-study-v1";
const warning = document.getElementById("storage-warning");
let completed = {};

function showStorageError(message, error) {
  console.error(message, error);
  warning.textContent = message;
  warning.hidden = false;
}

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
    throw new TypeError("Invalid saved progress.");
  }
  completed = saved;
} catch (error) {
  showStorageError("Saved progress could not be loaded. Check browser storage settings; existing saved data has not been overwritten.", error);
}

function updateProgress() {
  const count = studyItems.filter(item => completed[item.key] === true).length;
  document.getElementById("study-progress").max = studyItems.length;
  document.getElementById("study-progress").value = count;
  document.getElementById("progress-label").textContent = `${count} / ${studyItems.length} complete`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

for (const stage of stages) {
  const section = element("section", "study-stage");
  const headingId = `stage-${stage.id}`;
  section.setAttribute("aria-labelledby", headingId);
  const top = element("div", "stage-top");
  top.append(element("span", "", stage.label), element("span", "", stage.date));
  const heading = element("h2", "", stage.title);
  heading.id = headingId;
  section.append(top, heading, element("p", "", stage.topic));
  const list = element("ul", "study-items");
  for (const item of stage.items) {
    const key = `${stage.id}:${item.id}`;
    const row = element("li");
    const content = element("div");
    const label = element("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = completed[key] === true;
    checkbox.addEventListener("change", () => {
      completed[key] = checkbox.checked;
      updateProgress();
      try {
        localStorage.setItem(storageKey, JSON.stringify(completed));
        warning.hidden = true;
      } catch (error) {
        showStorageError("Your latest change could not be saved. Progress will be lost on reload unless browser storage is enabled.", error);
      }
    });
    label.append(checkbox, element("span", "", item.title));
    content.append(label, element("small", "", item.focus));
    const link = element("a", "", `${item.source || "Learn"} \u2197`);
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `${item.source || "Learn"}: ${item.title} (opens in a new tab)`);
    row.append(content, link);
    list.append(row);
  }
  section.append(list, element("p", "lab-goal", stage.output));
  document.getElementById("study-stages").append(section);
}

updateProgress();
document.getElementById("print-plan").addEventListener("click", () => window.print());
