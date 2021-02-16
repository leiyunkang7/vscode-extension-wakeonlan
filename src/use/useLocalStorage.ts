import { ref, effect } from "@vue/reactivity";
import { useContext } from "./useContext";

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const SERIALIZERS = {
  boolean: {
    read: (v: any, d: any) => (v !== null ? v === 'true' : d),
    write: (v: any) => String(v),
  },
  object: {
    read: (v: any, d: any) => (v ? JSON.parse(v) : d),
    write: (v: any) => JSON.stringify(v),
  },
  number: {
    read: (v: any, d: any) => (v !== null ? Number.parseFloat(v) : d),
    write: (v: any) => String(v),
  },
  any: {
    read: (v: any, d: any) => (v !== null ? v : d),
    write: (v: any) => String(v),
  },
  string: {
    read: (v: any, d: any) => (v !== null ? v : d),
    write: (v: any) => String(v),
  },
}

/**
 * Reactive LocalStorage/SessionStorage.
 *
 * @see   {@link https://vueuse.js.org/useStorage}
 * @param key
 * @param defaultValue
 * @param storage
 * @param options
 */
export function useLocalStorage<T extends string | number | boolean | object | null>(
  key: string,
  defaultValue: T
) {
  const { context } = useContext()

  const storage: StorageLike = {
    getItem(key: string) {
      return context.value.globalState.get(key) || ''
    },
    setItem(key: string, value: string) {
      return context.value.globalState.update(key, value)
    },
    removeItem(key: string) {
      context.value.globalState.update(key, '')
    },
  }

  const data = ref<T>(defaultValue)

  const type =
    defaultValue === null
      ? 'any'
      : typeof defaultValue === 'boolean'
      ? 'boolean'
      : typeof defaultValue === 'string'
      ? 'string'
      : typeof defaultValue === 'object'
      ? 'object'
      : Array.isArray(defaultValue)
      ? 'object'
      : !Number.isNaN(defaultValue)
      ? 'number'
      : 'any'

  function read() {
    try {
      let rawValue = storage.getItem(key)
      if (rawValue === null && defaultValue) {
        rawValue = SERIALIZERS[type].write(defaultValue)
        storage.setItem(key, rawValue)
      } else {
        data.value = SERIALIZERS[type].read(rawValue, defaultValue)
      }
    } catch (e) {
      console.warn(e)
    }
  }

  read()

  effect(
    () => {
      if (!storage) {
        // SSR
        return
      }

      try {
        if (data.value === null) {
          storage.removeItem(key)
        } else {
          storage.setItem(key, SERIALIZERS[type].write(data.value))
        }
      } catch (e) {
        console.warn(e)
      }
    },
    {
      allowRecurse: true,
    }
  )

  return data
}
