declare module 'jsonc-parser' {
  export function parseTree(text: string): any;
  export function findNodeAtLocation(tree: any, path: (string | number)[]): any;
}
