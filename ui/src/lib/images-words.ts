// PLA-I2-10: the words of the pictures on a request (ui/src/components/corriente/images.tsx).
import { defineWords } from "./i18n.js";

export const IMAGES_WORDS = defineWords({
  es: {
    badType: "Solo se aceptan imágenes PNG, JPEG o WebP.",
    tooBig: "Esa imagen pesa más de 5 MB.",
    tooMany: (max: number) => `Un pedido admite hasta ${max} imágenes.`,
    list: "Imágenes del pedido",
    image: (n: number) => `Imagen ${n}`,
    remove: (n: number) => `Quitar imagen ${n}`,
    hint: "Arrastra, pega con ⌘V o elige imágenes. PNG, JPEG o WebP, hasta 5 MB cada una.",
    choose: "Elegir imágenes",
  },
  en: {
    badType: "Only PNG, JPEG or WebP images are accepted.",
    tooBig: "That image is over 5 MB.",
    tooMany: (max: number) => `A request takes up to ${max} images.`,
    list: "The request's images",
    image: (n: number) => `Image ${n}`,
    remove: (n: number) => `Remove image ${n}`,
    hint: "Drag, paste with ⌘V or choose images. PNG, JPEG or WebP, up to 5 MB each.",
    choose: "Choose images",
  },
});
