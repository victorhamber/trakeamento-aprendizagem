declare module 'lru-cache' {
    class LRUCache<K = any, V = any> {
        constructor(options: { max: number; ttl?: number; maxAge?: number });
        get(key: K): V | undefined;
        set(key: K, value: V, options?: { ttl?: number }): this;
        has(key: K): boolean;
        delete(key: K): boolean;
        clear(): void;
        readonly size: number;
    }
    export { LRUCache };
}
