declare module 'node-ruuvitag' {
  export function on(event: 'found', callback: (tag: any) => void): void;
  // Add other methods or events as needed
}