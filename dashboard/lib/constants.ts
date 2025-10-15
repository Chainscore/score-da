// Protocol color scheme
export const protocolColors = {
  Polkadot: "#E6007A",
  Celestia: "#7B2BF9",
  Espresso: "#FF6B35",
  NEAR: "#00C08B",
  Avail: "#2E5CFF",
} as const;

export type Protocol = keyof typeof protocolColors;

export const protocols: Protocol[] = [
  "Polkadot",
  "Celestia", 
  "Espresso",
  "NEAR",
  "Avail",
];
