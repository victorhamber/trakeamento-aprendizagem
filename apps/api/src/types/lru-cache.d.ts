declare module 'lru-cache' {
    class LRUCache<K = any, V = any> {
        constructor(options: { max: number; maxAge?: number });
        get(key: K): V | undefined;
        set(key: K, value: V): this;
        has(key: K): boolean;
        delete(key: K): boolean;
        clear(): void;
        readonly size: number;
    }
    export = LRUCache;
}
