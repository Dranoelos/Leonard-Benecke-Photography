const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".site-nav");
const year = document.querySelector("#year");
const galleryImages = document.querySelectorAll(".photo-grid img");
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

galleryImages.forEach((image) => {
  const imageWidth = Number(image.getAttribute("width"));
  const imageHeight = Number(image.getAttribute("height"));

  if (imageWidth > 0 && imageHeight > 0) {
    image.style.aspectRatio = `${imageWidth} / ${imageHeight}`;
  }
});

document.querySelectorAll(".photo-grid-events figure").forEach((figure) => {
  const image = figure.querySelector("img");
  const fileName =
    (image?.dataset.src || image?.getAttribute("src"))?.split("/").pop()?.toLowerCase() ?? "";
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

function getFigureHeightRatio(figure) {
  const image = figure.querySelector("img");
  const imageWidth = Number(image?.getAttribute("width"));
  const imageHeight = Number(image?.getAttribute("height"));

  return imageWidth > 0 && imageHeight > 0 ? imageHeight / imageWidth : null;
}

function getBalancedColumnIndexes(figures) {
  const ratios = figures.map(getFigureHeightRatio);

  if (ratios.some((ratio) => ratio === null) || ratios.length > 24) {
    return null;
  }

  const totalHeight = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const combinationCount = 2 ** ratios.length;
  let bestColumnIndexes = new Set();
  let bestHeightDifference = Infinity;
  let bestCountDifference = Infinity;

  for (let mask = 1; mask < combinationCount; mask += 1) {
    if ((mask & 1) === 0) {
      continue;
    }

    let columnHeight = 0;
    let columnCount = 0;
    const columnIndexes = new Set();

    ratios.forEach((ratio, index) => {
      if (mask & (2 ** index)) {
        columnHeight += ratio;
        columnCount += 1;
        columnIndexes.add(index);
      }
    });

    const heightDifference = Math.abs(totalHeight - columnHeight * 2);
    const countDifference = Math.abs(figures.length - columnCount * 2);

    if (
      heightDifference < bestHeightDifference ||
      (heightDifference === bestHeightDifference && countDifference < bestCountDifference)
    ) {
      bestColumnIndexes = columnIndexes;
      bestHeightDifference = heightDifference;
      bestCountDifference = countDifference;
    }
  }

  return bestColumnIndexes;
}

function columnizeGallery(grid, state) {
  if (state.columns) {
    return;
  }

  const columns = [document.createElement("div"), document.createElement("div")];
  const balancedColumnIndexes = getBalancedColumnIndexes(state.figures);

  columns.forEach((column) => {
    column.className = "photo-grid-column";
    grid.append(column);
  });

  state.figures.forEach((figure, index) => {
    const columnIndex = balancedColumnIndexes ? (balancedColumnIndexes.has(index) ? 0 : 1) : index % columns.length;

    columns[columnIndex].append(figure);
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

function loadGalleryImage(image) {
  if (!image.dataset.src || image.getAttribute("src")) {
    return;
  }

  image.src = image.dataset.src;
  image.removeAttribute("data-src");
}

function beginGalleryImageLoading() {
  const deferredImages = Array.from(galleryImages).filter((image) => image.dataset.src);

  if (!deferredImages.length) {
    return;
  }

  if (!("IntersectionObserver" in window)) {
    deferredImages.forEach(loadGalleryImage);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        loadGalleryImage(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "240px 0px" },
  );

  deferredImages.forEach((image) => observer.observe(image));
}

function waitForHeroVideoBeforeGalleryImages() {
  const heroVideo = document.querySelector(".hero video");

  if (!heroVideo) {
    beginGalleryImageLoading();
    return;
  }

  let hasReleasedGallery = false;
  const releaseGallery = () => {
    if (hasReleasedGallery) {
      return;
    }

    hasReleasedGallery = true;
    beginGalleryImageLoading();
  };

  if (heroVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    releaseGallery();
    return;
  }

  heroVideo.addEventListener("playing", releaseGallery, { once: true });
  heroVideo.addEventListener("canplay", releaseGallery, { once: true });
  heroVideo.addEventListener("loadeddata", releaseGallery, { once: true });
  heroVideo.addEventListener("error", releaseGallery, { once: true });
  window.setTimeout(releaseGallery, 10000);
}

waitForHeroVideoBeforeGalleryImages();

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

  lightboxImage.src = image.currentSrc || image.src || image.dataset.src;
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
