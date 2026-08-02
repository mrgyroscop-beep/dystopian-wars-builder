interface DecimalValue {
  readonly coefficient: bigint;
  readonly scale: number;
}

const DECIMAL = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/u;

export function parseDecimal(value: string): DecimalValue | null {
  const match = DECIMAL.exec(value);
  if (!match) return null;
  const fraction = match[3] ?? "";
  const digits = `${match[2]}${fraction}`;
  const coefficient = BigInt(digits) * (match[1] === "-" ? -1n : 1n);
  return normalize({ coefficient, scale: fraction.length });
}

export function decimalToString(value: DecimalValue): string {
  const normalized = normalize(value);
  if (normalized.coefficient === 0n) return "0";
  const negative = normalized.coefficient < 0n;
  const digits = (negative ? -normalized.coefficient : normalized.coefficient).toString();
  if (normalized.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(normalized.scale + 1, "0");
  const pivot = padded.length - normalized.scale;
  return `${negative ? "-" : ""}${padded.slice(0, pivot)}.${padded.slice(pivot)}`;
}

export function addDecimal(left: DecimalValue, right: DecimalValue): DecimalValue {
  const scale = Math.max(left.scale, right.scale);
  return normalize({
    coefficient:
      left.coefficient * powerOfTen(scale - left.scale) +
      right.coefficient * powerOfTen(scale - right.scale),
    scale,
  });
}

export function multiplyDecimal(left: DecimalValue, right: DecimalValue): DecimalValue {
  return normalize({
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  });
}

export function multiplyDecimalByInteger(value: DecimalValue, multiplier: number): DecimalValue {
  return normalize({ coefficient: value.coefficient * BigInt(multiplier), scale: value.scale });
}

export function compareDecimal(left: DecimalValue, right: DecimalValue): number {
  const scale = Math.max(left.scale, right.scale);
  const leftValue = left.coefficient * powerOfTen(scale - left.scale);
  const rightValue = right.coefficient * powerOfTen(scale - right.scale);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export function zeroDecimal(): DecimalValue {
  return { coefficient: 0n, scale: 0 };
}

function normalize(value: DecimalValue): DecimalValue {
  let { coefficient, scale } = value;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function powerOfTen(power: number): bigint {
  return 10n ** BigInt(power);
}

export type { DecimalValue };
