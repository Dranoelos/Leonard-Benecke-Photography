const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".site-nav");
const year = document.querySelector("#year");
const eventCaptions = [
  ["lucky", "Lucky Who Bar"],
  ["goru", "Goru Seven"],
  ["hiphopisland", "HipHopIsland"],
];

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
