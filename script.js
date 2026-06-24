const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".site-nav");
const year = document.querySelector("#year");
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
