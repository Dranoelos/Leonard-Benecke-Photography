// Galleries use one ordered list; CSS controls the number of columns.
// Include gallery-data.js before this script when enabling data-gallery grids.
function createGalleryFigure(photo) {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.dataset.src = photo.src;
    image.dataset.sdrSrc = photo.src;
    image.width = photo.width;
    image.height = photo.height;
    image.alt = photo.alt;
    image.loading = "lazy";
    image.decoding = "async";
    figure.dataset.src = photo.src;
    figure.dataset.hidden = String(photo.hidden === true);
    figure.classList.toggle("is-hidden", photo.hidden === true);
    if (photo.hdrSrc) {
      image.dataset.hdrSrc = photo.hdrSrc;
      const picture = document.createElement("picture");
      const source = document.createElement("source");
      source.type = "image/jpeg";
      source.media = "(dynamic-range: high)";
      source.dataset.srcset = photo.hdrSrc;
      picture.append(source, image);
      figure.append(picture);
    } else {
      figure.append(image);
    }
    return figure;
}

document.querySelectorAll(".photo-grid[data-gallery]").forEach((grid) => {
  const photos = window.GALLERY_DATA?.[grid.dataset.gallery];
  if (!Array.isArray(photos)) return;
  const figures = photos
    .filter(photo => !photo.hidden || grid.hasAttribute("data-show-hidden"))
    .map(createGalleryFigure);
  grid.replaceChildren(...figures);
});

function alternateMobileGalleryRow(previous, current) {
  if (previous?.length !== 2 || current.length !== 2) return current;
  const photos = [...previous, ...current];
  if (!photos.every(figure => figure.dataset.category === current[0].dataset.category)) return current;
  const orientations = photos.map(figure => {
    const image = figure.querySelector("img");
    return Math.sign(Number(image.getAttribute("width")) - Number(image.getAttribute("height")));
  });
  // Break repeated portrait/landscape rows without crossing category boundaries.
  return orientations.join(",") === "-1,1,-1,1" ? [...current].reverse() : current;
}

document.querySelectorAll("[data-gallery-feed]").forEach((grid) => {
  const figures = Object.entries(window.GALLERY_DATA || {}).flatMap(([category, photos]) => photos.filter(photo => !photo.hidden).map(photo => {
    const figure = createGalleryFigure(photo);
    figure.dataset.category = category;
    figure.style.setProperty("--photo-ratio", photo.width / photo.height);
    return figure;
  }));
  let selectedFilter = "all";
  const filters = [...document.querySelectorAll("[data-photo-filter]")];
  const status = document.querySelector("[data-gallery-status]");
  const phone = window.matchMedia("(max-width: 780px)");
  const tablet = window.matchMedia("(max-width: 1100px)");
  const layoutRows = () => {
    const maximum = phone.matches ? 2 : tablet.matches ? 3 : 4;
    const selectedFigures = figures.filter(figure => selectedFilter === "all" || figure.dataset.category === selectedFilter);
    // Equal-height rows preserve the full original crop.
    // Keep the current height while moving nodes to avoid collapsing the page.
    grid.style.minHeight = `${grid.getBoundingClientRect().height}px`;
    const rows = document.createDocumentFragment();
    let index = 0;
    let previousRow = null;
    while (index < selectedFigures.length) {
      const remaining = selectedFigures.length - index;
      const count = maximum > 2 && remaining === maximum + 1 ? maximum - 1 : Math.min(maximum, remaining);
      const row = document.createElement("div");
      row.className = "gallery-row";
      let rowFigures = selectedFigures.slice(index, index + count);
      if (phone.matches) rowFigures = alternateMobileGalleryRow(previousRow, rowFigures);
      row.append(...rowFigures);
      rows.append(row);
      previousRow = rowFigures;
      index += count;
    }
    grid.replaceChildren(rows);
    grid.style.minHeight = "";
    if (status) status.textContent = `${selectedFigures.length} Fotos · ${filters.find(button => button.dataset.photoFilter === selectedFilter)?.textContent || "All"}`;
  };
  filters.forEach(button => button.addEventListener("click", () => {
    selectedFilter = button.dataset.photoFilter;
    filters.forEach(filter => filter.setAttribute("aria-pressed", String(filter === button)));
    layoutRows();
  }));
  layoutRows();
  phone.addEventListener("change", layoutRows);
  tablet.addEventListener("change", layoutRows);
});

const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".site-nav");
const year = document.querySelector("#year");
const heroVideo = document.querySelector(".hero video");
const galleryImages = document.querySelectorAll(".photo-grid img");
const eventCaptions = [
  ["lucky", "Lucky Who Bar"],
  ["goru", "Goru Seven"],
  ["hiphopisland", "HipHopIsland"],
];
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

const contactSection = document.querySelector("#contact");
const contactLinks = contactSection?.querySelector(".contact-links");
let contactArrivalObserver;
let contactAttentionTimer;
let contactArrivalTimer;

if (contactSection && contactLinks) {
  const emphasizeContact = () => {
    contactArrivalObserver?.disconnect();
    window.clearTimeout(contactArrivalTimer);
    window.clearTimeout(contactAttentionTimer);
    contactLinks.classList.remove("is-highlighted");
    contactLinks.classList.add("is-highlighted");
    document.querySelector("#contact-email")?.focus({ preventScroll: true });
    contactAttentionTimer = window.setTimeout(() => contactLinks.classList.remove("is-highlighted"), 3600);
  };

  document.querySelectorAll('a[href="#contact"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      contactArrivalObserver?.disconnect();
      window.clearTimeout(contactArrivalTimer);
      if (window.location.hash !== "#contact") window.history.pushState(null, "", "#contact");
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const bounds = contactLinks.getBoundingClientRect();
      if (bounds.top >= 0 && bounds.bottom <= window.innerHeight) {
        emphasizeContact();
      } else if ("IntersectionObserver" in window) {
        contactArrivalObserver = new IntersectionObserver((entries) => {
          if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5)) emphasizeContact();
        }, { threshold: 0.5 });
        contactArrivalObserver.observe(contactLinks);
        contactArrivalTimer = window.setTimeout(() => contactArrivalObserver?.disconnect(), 10000);
      } else {
        contactArrivalTimer = window.setTimeout(emphasizeContact, reducedMotion ? 0 : 700);
      }
      contactSection.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
    });
  });
}

function loadHeroVideo() {
  if (!heroVideo) {
    return;
  }

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const prefersHdr =
    window.matchMedia?.("(dynamic-range: high)").matches &&
    heroVideo.canPlayType('video/mp4; codecs="hvc1.2.4.L150.B0"') !== "";
  const isSlowConnection =
    connection?.saveData ||
    ["slow-2g", "2g", "3g"].includes(connection?.effectiveType) ||
    (typeof connection?.downlink === "number" && connection.downlink > 0 && connection.downlink < 1.5);
  const selectedSource = isSlowConnection
    ? prefersHdr && heroVideo.dataset.lowHdrSrc
      ? heroVideo.dataset.lowHdrSrc
      : heroVideo.dataset.lowSdrSrc || heroVideo.dataset.sdrSrc
    : prefersHdr && heroVideo.dataset.hdrSrc
      ? heroVideo.dataset.hdrSrc
      : heroVideo.dataset.sdrSrc;

  if (!selectedSource) {
    return;
  }

  const preload = document.createElement("link");
  preload.rel = "preload";
  preload.as = "video";
  preload.href = selectedSource;
  preload.fetchPriority = "high";
  document.head.append(preload);

  const sdrFallback = isSlowConnection
    ? heroVideo.dataset.lowSdrSrc || heroVideo.dataset.sdrSrc
    : heroVideo.dataset.sdrSrc;

  if (prefersHdr && sdrFallback && selectedSource !== sdrFallback) {
    heroVideo.addEventListener("error", () => {
      preload.href = sdrFallback;
      heroVideo.src = sdrFallback;
      heroVideo.load();
      heroVideo.play().catch(() => {});
    }, { once: true });
  }

  heroVideo.src = selectedSource;
  heroVideo.load();
  heroVideo.play().catch(() => {});
}

loadHeroVideo();

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

function loadGalleryImage(image) {
  const source = image.closest("picture")?.querySelector("source[data-srcset]");
  if (source && !source.hasAttribute("srcset")) source.srcset = source.dataset.srcset;
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
  lightbox?.querySelector("source")?.removeAttribute("srcset");
}

function openLightbox(image) {
  if (!lightbox || !lightboxImage) {
    return;
  }

  const source = lightbox.querySelector("source");
  source.media = image.closest("picture")?.querySelector("source")?.media || "(dynamic-range: high)";
  if (image.dataset.hdrSrc) source.srcset = image.dataset.hdrSrc;
  else source.removeAttribute("srcset");
  lightboxImage.src = image.dataset.sdrSrc || image.currentSrc || image.src || image.dataset.src;
  lightboxImage.alt = image.alt;
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("lightbox-open");
}

if (document.querySelector(".photo-grid")) {
  lightbox = document.createElement("div");
  lightbox.className = "lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-hidden", "true");
  lightbox.innerHTML = `
    <button class="lightbox-close" type="button" aria-label="Close image view">Close</button>
    <picture><source type="image/jpeg" media="(dynamic-range: high)" /><img class="lightbox-image" alt="" /></picture>
  `;
  document.body.append(lightbox);

  lightboxImage = lightbox.querySelector(".lightbox-image");
  lightbox.querySelector(".lightbox-close")?.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) {
      closeLightbox();
    }
  });

  document.addEventListener("click", (event) => {
    const image = event.target.closest(".photo-grid img");
    if (image) {
      loadGalleryImage(image);
      openLightbox(image);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLightbox();
    }
  });
}
