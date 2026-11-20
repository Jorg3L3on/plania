// PLA-I66-4: two pictures look the same at 32 px: a regenerated icon of the same logo is not a new logo.
import sharp from "sharp";

export async function looksSame(a: Buffer, b: Buffer): Promise<boolean> {
  const at = async (x: Buffer) => sharp(x, { density: 192 }).resize(32, 32, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).greyscale().raw().toBuffer();
  try {
    const [p, q] = await Promise.all([at(a), at(b)]);
    let d = 0;
    for (let i = 0; i < p.length; i++) d += Math.abs(p[i]! - q[i]!);
    return d / p.length < 14;
  } catch {
    return false;
  }
}
