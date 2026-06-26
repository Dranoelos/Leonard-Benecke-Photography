const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".site-nav");
const year = document.querySelector("#year");
const galleryImages = document.querySelectorAll(".photo-grid img");
const heroVideo = document.querySelector(".hero video");
const galleryGrids = document.querySelectorAll(".photo-grid");
const desktopGalleryQuery = window.matchMedia("(min-width: 561px)");
const eventCaptions = [
  ["lucky", "Lucky Who Bar"],
  ["goru", "Goru Seven"],
  ["hiphopisland", "HipHopIsland"],
];
const galleryStates = new Map();
let lightbox;
let lightboxImage;

if (menuButton && navigation) {
  menuButton.addEventListener("click", () => {
    const isOpen = navigation.classList.toggle("is-open");

    document.body.classList.toggle("nav-open", isOpen);
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.textContent = isOpen ? "Close" : "Menu";
  });

  navigation.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navigation.classList.remove("is-open");
      document.body.classList.remove("nav-open");
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.textContent = "Menu";
    });
  });
}

if (year) {
  year.textContent = new Date().getFullYear();
}

if (heroVideo) {
  const hdrSource = heroVideo.dataset.hdrSrc;
  const sdrSource = heroVideo.dataset.sdrSrc;
  const lowHdrSource = heroVideo.dataset.lowHdrSrc;
  const lowSdrSource = heroVideo.dataset.lowSdrSrc;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const prefersHdr = window.matchMedia?.("(dynamic-range: high)").matches;
  const isSlowConnection =
    connection?.saveData ||
    ["slow-2g", "2g", "3g"].includes(connection?.effectiveType) ||
    (typeof connection?.downlink === "number" && connection.downlink > 0 && connection.downlink < 1.5);
  const selectedSource = isSlowConnection
    ? prefersHdr && lowHdrSource
      ? lowHdrSource
      : lowSdrSource || sdrSource
    : prefersHdr && hdrSource
      ? hdrSource
      : sdrSource;

  if (selectedSource) {
    heroVideo.src = selectedSource;
    heroVideo.load();
    heroVideo.play().catch(() => {});
  }
}

document.querySelectorAll(".photo-grid-events figure").forEach((figure) => {
  const image = figure.querySelector("img");
  const fileName = image?.getAttribute("src")?.split("/").pop()?.toLowerCase() ?? "";
  const captionText = eventCaptions.find(([key]) => fileName.includes(key))?.[1];

  if (!captionText) {
    return;
  }

  const caption = document.createElement("figcaption");
  caption.textContent = captionText;
  figure.append(caption);
});

function restoreGalleryOrder(grid, state) {
  state.figures.forEach((figure) => grid.append(figure));
  state.columns?.forEach((column) => column.remove());
  state.columns = null;
  grid.classList.remove("is-columnized");
}

function columnizeGallery(grid, state) {
  if (state.columns) {
    return;
  }

  const columns = [document.createElement("div"), document.createElement("div")];
  columns.forEach((column) => {
    column.className = "photo-grid-column";
    grid.append(column);
  });

  state.figures.forEach((figure, index) => {
    columns[index % columns.length].append(figure);
  });

  state.columns = columns;
  grid.classList.add("is-columnized");
}

function updateGalleryLayouts() {
  galleryGrids.forEach((grid) => {
    const state =
      galleryStates.get(grid) ??
      {
        figures: Array.from(grid.children).filter((child) => child.matches("figure")),
        columns: null,
      };

    galleryStates.set(grid, state);

    if (desktopGalleryQuery.matches) {
      columnizeGallery(grid, state);
    } else {
      restoreGalleryOrder(grid, state);
    }
  });
}

if (galleryGrids.length) {
  updateGalleryLayouts();

  if (desktopGalleryQuery.addEventListener) {
    desktopGalleryQuery.addEventListener("change", updateGalleryLayouts);
  } else {
    desktopGalleryQuery.addListener(updateGalleryLayouts);
  }
}

function closeLightbox() {
  lightbox?.classList.remove("is-open");
  lightbox?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("lightbox-open");
  lightboxImage?.removeAttribute("src");
  lightboxImage?.removeAttribute("alt");
}

function openLightbox(image) {
  if (!lightbox || !lightboxImage) {
    return;
  }

  lightboxImage.src = image.src;
  lightboxImage.alt = image.alt;
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("lightbox-open");
}

if (galleryImages.length) {
  lightbox = document.createElement("div");
  lightbox.className = "lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-hidden", "true");
  lightbox.innerHTML = `
    <button class="lightbox-close" type="button" aria-label="Close image view">Close</button>
    <img class="lightbox-image" alt="" />
  `;
  document.body.append(lightbox);

  lightboxImage = lightbox.querySelector(".lightbox-image");
  lightbox.querySelector(".lightbox-close")?.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) {
      closeLightbox();
    }
  });

  galleryImages.forEach((image) => {
    image.addEventListener("click", () => openLightbox(image));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLightbox();
    }
  });
}
