// PLA-I66-3: the refusals the owner reads on the Marca door, in the install's language (Spanish unchanged).
import { defineWords } from "../words.js";

export const MARCA_WORDS = defineWords({
  es: {
    errors: {
      empty: "No llegó ningún archivo.",
      big: "El archivo pesa más de 5 MB.",
      type: "Solo se aceptan SVG, PNG, JPG o WebP.",
      unsafe: "El SVG trae algo que no se puede limpiar sin romperlo. Expórtalo de nuevo como SVG simple.",
      unreadable: "No se pudo leer la imagen.",
      tooSmall: "La imagen mide menos de 512 px: el ícono de Android y la imagen para compartir saldrían borrosos. Súbela de 1024 px o en SVG.",
      upNotFound: "Ese archivo ya no está; súbelo otra vez.",
      adjust: "El tamaño va de 40 a 100 y el fondo es un color #rrggbb o ninguno.",
      notCandidate: "Ese archivo no es uno de los logos que Plania encontró en el repo.",
      versionNotFound: "No existe esa versión del logo.",
    },
  },
  en: {
    errors: {
      empty: "No file arrived.",
      big: "The file is larger than 5 MB.",
      type: "Only SVG, PNG, JPG or WebP are accepted.",
      unsafe: "The SVG holds something that cannot be cleaned without breaking it. Export it again as a plain SVG.",
      unreadable: "The image could not be read.",
      tooSmall: "The image is under 512 px: the Android icon and the share image would come out blurry. Upload it at 1024 px or as SVG.",
      upNotFound: "That file is gone; upload it again.",
      adjust: "The size goes from 40 to 100 and the background is a #rrggbb colour or none.",
      notCandidate: "That file is not one of the logos Plania found in the repo.",
      versionNotFound: "That version of the logo does not exist.",
    },
  },
});
