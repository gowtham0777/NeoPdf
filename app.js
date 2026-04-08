(function () {
  const { PDFDocument } = window.PDFLib;

  const state = {
    pages: [],
    history: [],
    mode: "idle",
    insertionIndex: null,
    pendingInsertIndex: null,
    sortable: null,
    busy: false,
    isProcessing: false,
  };

  const elements = {
    heroUploadButton: document.getElementById("heroUploadButton"),
    dropzone: document.getElementById("dropzone"),
    dropzoneStatus: document.getElementById("dropzoneStatus"),
    fileInput: document.getElementById("fileInput"),
    editorCard: document.getElementById("editorCard"),
    pagesGrid: document.getElementById("pagesGrid"),
    emptyEditor: document.getElementById("emptyEditor"),
    addImagesButton: document.getElementById("addImagesButton"),
    removePagesButton: document.getElementById("removePagesButton"),
    undoButton: document.getElementById("undoButton"),
    downloadButton: document.getElementById("downloadButton"),
    downloadSpinner: document.getElementById("downloadSpinner"),
    downloadButtonLabel: document.getElementById("downloadButtonLabel"),
    statusText: document.getElementById("statusText"),
    pageCountPill: document.getElementById("pageCountPill"),
    modeBanner: document.getElementById("modeBanner"),
    insertHintPill: document.getElementById("insertHintPill"),
    insertBeforeAll: document.getElementById("insertBeforeAll"),
    clearAllButton: document.getElementById("clearAllButton"),
  };

  function createId() {
    return `page-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function pushHistory() {
    state.history.push({
      pages: [...state.pages],
      mode: state.mode,
      insertionIndex: state.insertionIndex,
    });
    if (state.history.length > 25) {
      state.history.shift();
    }
  }

  function updateUndoState() {
    elements.undoButton.disabled = state.history.length === 0;
  }

  function updateDropzoneStatus(count) {
    if (!count) {
      elements.dropzoneStatus.textContent = "";
      elements.dropzoneStatus.classList.add("hidden");
      return;
    }

    elements.dropzoneStatus.textContent = `${count} ${count === 1 ? "image" : "images"} selected`;
    elements.dropzoneStatus.classList.remove("hidden");
  }

  function humanFileSize(bytes) {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`;
    const units = ["KB", "MB", "GB"];
    let size = bytes / 1024;
    let unit = units[0];
    for (let index = 1; index < units.length && size >= 1024; index += 1) {
      size /= 1024;
      unit = units[index];
    }
    return `${size.toFixed(size >= 10 ? 0 : 1)} ${unit}`;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  function dataUrlToUint8Array(dataUrl) {
    const base64 = dataUrl.split(",")[1];
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function getImageSize(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("Could not load image dimensions"));
      image.src = dataUrl;
    });
  }

  function normalizeImageForPdf(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Canvas is unavailable in this browser."));
          return;
        }

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        resolve({
          dataUrl: canvas.toDataURL("image/png"),
        });
      };
      image.onerror = () => reject(new Error("Could not normalize image format."));
      image.src = dataUrl;
    });
  }

  async function filesToPages(files) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const pages = [];
    for (const file of imageFiles) {
      const originalDataUrl = await readFileAsDataUrl(file);
      const dimensions = await getImageSize(originalDataUrl);
      const normalized = await normalizeImageForPdf(originalDataUrl);
      pages.push({
        id: createId(),
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: originalDataUrl,
        bytes: dataUrlToUint8Array(normalized.dataUrl),
        width: dimensions.width,
        height: dimensions.height,
      });
    }
    return pages;
  }

  function setMode(mode, insertionIndex) {
    state.mode = mode;
    state.insertionIndex = typeof insertionIndex === "number" ? insertionIndex : null;
    render();
  }

  function insertPages(newPages, index) {
    const insertAt = typeof index === "number" ? index : state.pages.length;
    state.pages.splice(insertAt, 0, ...newPages);
  }

  async function handleFiles(fileList, options = {}) {
    const files = Array.from(fileList || []);
    if (!files.length || state.busy) return;

    state.busy = true;
    try {
      const newPages = await filesToPages(files);
      if (!newPages.length) return;

      pushHistory();
      const insertIndex =
        typeof options.insertAt === "number"
          ? options.insertAt
          : typeof state.pendingInsertIndex === "number"
            ? state.pendingInsertIndex
            : state.pages.length;

      insertPages(newPages, insertIndex);
      state.pendingInsertIndex = null;
      state.mode = "idle";
      state.insertionIndex = null;
      state.busy = false;
      updateDropzoneStatus(newPages.length);
      render();
      elements.editorCard.classList.remove("hidden");
      elements.editorCard.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      window.alert(error.message || "Something went wrong while reading the images.");
    } finally {
      state.busy = false;
      elements.fileInput.value = "";
      updateUndoState();
      renderSummary();
    }
  }

  function openFilePicker(insertAt = null) {
    state.pendingInsertIndex = typeof insertAt === "number" ? insertAt : null;
    elements.fileInput.click();
  }

  function getModeMessage() {
    if (state.mode === "remove") {
      return "Remove Pages mode is on. Tap any thumbnail to delete it instantly.";
    }
    if (state.mode === "add") {
      return "Add Images mode is on. Pick where the new pages should be inserted, then choose files.";
    }
    return "";
  }

  function renderModeState() {
    elements.addImagesButton.classList.toggle("is-active", state.mode === "add");
    elements.removePagesButton.classList.toggle("is-active", state.mode === "remove");
    const message = getModeMessage();
    elements.modeBanner.textContent = message;
    elements.modeBanner.classList.toggle("hidden", !message);
    elements.insertHintPill.classList.toggle("hidden", state.mode !== "add");
    elements.insertBeforeAll.classList.toggle("hidden", state.mode !== "add" || state.pages.length === 0);
  }

  function renderPageCard(page, index) {
    const article = document.createElement("article");
    article.className = "page-card";
    article.dataset.id = page.id;
    article.dataset.index = String(index);
    if (state.mode === "remove") article.classList.add("is-remove-mode");
    if (state.mode === "add" && state.insertionIndex === index) article.classList.add("is-insert-target");

    article.innerHTML = `
      <div class="page-image-wrap">
        <img class="page-image" src="${page.dataUrl}" alt="${escapeHtml(page.name)} preview">
      </div>
      <div class="page-meta">
        <div class="page-title">
          <strong>${escapeHtml(page.name)}</strong>
          <span>${humanFileSize(page.size)}</span>
        </div>
        <span class="page-index">Page ${index + 1}</span>
      </div>
      <span class="page-remove-hint">Remove</span>
      <button class="page-insert-after ${state.mode === "add" ? "" : "hidden"}" type="button" data-insert-index="${index + 1}">
        Insert after page ${index + 1}
      </button>
    `;

    return article;
  }

  function renderPages() {
    elements.pagesGrid.innerHTML = "";
    if (!state.pages.length) {
      elements.emptyEditor.classList.remove("hidden");
      return;
    }

    elements.emptyEditor.classList.add("hidden");
    state.pages.forEach((page, index) => {
      elements.pagesGrid.appendChild(renderPageCard(page, index));
    });
  }

  function renderSummary() {
    const count = state.pages.length;
    elements.statusText.textContent = count === 0 ? "0 pages ready" : `${count} ${count === 1 ? "page" : "pages"} ready for export`;
    elements.pageCountPill.textContent = `${count} ${count === 1 ? "page" : "pages"}`;
    elements.downloadButton.disabled = count === 0 || state.busy || state.isProcessing;
    elements.clearAllButton.disabled = count === 0 || state.busy || state.isProcessing;
  }

  function setExportLoading(isLoading) {
    state.isProcessing = isLoading;
    elements.downloadSpinner.classList.toggle("hidden", !isLoading);
    elements.downloadButtonLabel.textContent = isLoading ? "Processing..." : "Download PDF";
    elements.downloadButton.disabled = isLoading || state.pages.length === 0;
    elements.addImagesButton.disabled = isLoading;
    elements.removePagesButton.disabled = isLoading;
    elements.undoButton.disabled = isLoading || state.history.length === 0;
    if (isLoading) {
      elements.statusText.textContent = `Working on ${state.pages.length} ${state.pages.length === 1 ? "page" : "pages"} for download...`;
    }
  }

  function render() {
    renderModeState();
    renderPages();
    renderSummary();
    updateUndoState();
    ensureSortable();
  }

  function ensureSortable() {
    if (state.sortable) {
      state.sortable.option("disabled", state.mode !== "idle");
      return;
    }

    state.sortable = new window.Sortable(elements.pagesGrid, {
      animation: 170,
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      disabled: state.mode !== "idle",
      onEnd(event) {
        if (event.oldIndex === event.newIndex || event.oldIndex == null || event.newIndex == null) {
          render();
          return;
        }

        pushHistory();
        const [moved] = state.pages.splice(event.oldIndex, 1);
        state.pages.splice(event.newIndex, 0, moved);
        state.mode = "idle";
        state.insertionIndex = null;
        render();
      },
    });
  }

  function removePage(index) {
    if (index < 0 || index >= state.pages.length) return;
    pushHistory();
    state.pages.splice(index, 1);
    if (!state.pages.length) {
      state.mode = "idle";
      state.insertionIndex = null;
    }
    render();
  }

  function clearAllPages() {
    if (!state.pages.length) return;
    pushHistory();
    state.pages = [];
    state.mode = "idle";
    state.insertionIndex = null;
    render();
  }

  function undoLastAction() {
    const snapshot = state.history.pop();
    if (!snapshot) return;
    state.pages = [...snapshot.pages];
    state.mode = snapshot.mode;
    state.insertionIndex = snapshot.insertionIndex;
    render();
  }

  function downloadBlob(blob, filename) {
    if (typeof window.saveAs === "function") {
      window.saveAs(blob, filename);
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  function waitForNextPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  async function buildPdf() {
    if (!state.pages.length || state.busy) return;

    state.busy = true;
    setExportLoading(true);
    await waitForNextPaint();

    try {
      const pdf = await PDFDocument.create();
      for (const page of state.pages) {
        const embeddedImage = await pdf.embedPng(page.bytes);
        const pdfPage = pdf.addPage([page.width, page.height]);
        pdfPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: page.width,
          height: page.height,
        });
      }

      const pdfBytes = await pdf.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      downloadBlob(blob, `neopdf-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      console.error("NeoPDF export failed:", error);
      window.alert(error?.message ? `Unable to create the PDF.\n\n${error.message}` : "Unable to create the PDF.");
    } finally {
      state.busy = false;
      setExportLoading(false);
      renderSummary();
    }
  }

  function onGridClick(event) {
    const insertButton = event.target.closest("[data-insert-index]");
    if (insertButton && state.mode === "add") {
      const insertIndex = Number(insertButton.dataset.insertIndex);
      state.insertionIndex = insertIndex;
      render();
      openFilePicker(insertIndex);
      return;
    }

    const card = event.target.closest(".page-card");
    if (!card) return;

    const index = Number(card.dataset.index);
    if (state.mode === "remove") {
      removePage(index);
      return;
    }

    if (state.mode === "add") {
      state.insertionIndex = index;
      render();
    }
  }

  function onDropzoneInteraction(event) {
    event.preventDefault();
    if ("dataTransfer" in event && event.type === "drop") {
      elements.dropzone.classList.remove("is-dragging");
      updateDropzoneStatus(event.dataTransfer.files.length);
      handleFiles(event.dataTransfer.files);
      return;
    }
    if (event.type === "dragenter" || event.type === "dragover") {
      elements.dropzone.classList.add("is-dragging");
      return;
    }
    if (event.type === "dragleave") {
      elements.dropzone.classList.remove("is-dragging");
    }
  }

  function bindEvents() {
    elements.heroUploadButton.addEventListener("click", () => openFilePicker());
    elements.dropzone.addEventListener("click", () => openFilePicker());
    elements.fileInput.addEventListener("change", (event) => handleFiles(event.target.files));

    ["dragenter", "dragover", "dragleave", "drop"].forEach((type) => {
      elements.dropzone.addEventListener(type, onDropzoneInteraction);
    });

    elements.addImagesButton.addEventListener("click", () => {
      if (!state.pages.length) {
        openFilePicker();
        return;
      }
      if (state.mode === "add") {
        setMode("idle");
        return;
      }
      setMode("add", state.pages.length);
    });

    elements.removePagesButton.addEventListener("click", () => {
      if (state.mode === "remove") {
        setMode("idle");
        return;
      }
      setMode("remove");
    });

    elements.clearAllButton.addEventListener("click", clearAllPages);
    elements.undoButton.addEventListener("click", undoLastAction);
    elements.downloadButton.addEventListener("click", buildPdf);
    elements.pagesGrid.addEventListener("click", onGridClick);
    elements.insertBeforeAll.addEventListener("click", () => {
      state.insertionIndex = 0;
      render();
      openFilePicker(0);
    });
  }

  bindEvents();
  render();
})();
