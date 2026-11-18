// PLA-82 (F-32): a release that carries database changes says so, and who migrates the app's own database.
export function migrationLine(files: string[], how: "auto" | "manual" | null, title: string): string {
  const list = files.length > 3 ? `${files.slice(0, 3).join(", ")} y ${files.length - 3} más` : files.join(", ");
  const what = `Lleva ${files.length === 1 ? "un cambio" : `${files.length} cambios`} a la base de datos (${list}).`;
  return how === "auto" ? `${what} Al publicar, Plania respalda la base de ${title} y la migra.` : `${what} Después de publicar hay que migrar la base de ${title}: Plania no sabe cómo en este proyecto.`;
}

