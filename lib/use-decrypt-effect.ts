"use client"

import { useState, useEffect, useCallback, useRef } from "react"

export const CIPHER_CHARS = "!@#$%^&*()_+-=[]{}|;':,./<>?0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZαβγδεζηθικλμνξοπρστυφχψω"

export function generateScramble(s: string): string {
  return s.split("").map((c) =>
    c === " " || c === "\n" ? c : CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)]
  ).join("")
}

interface UseDecryptEffectOptions {
  duration?: number
  onComplete?: () => void
}

export function useDecryptEffect(options: UseDecryptEffectOptions = {}) {
  const { duration = 1000, onComplete } = options
  const [displayValue, setDisplayValue] = useState("")
  const [isDecrypting, setIsDecrypting] = useState(false)
  const targetRef = useRef("")
  const onCompleteRef = useRef(onComplete)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  const getRandomChar = () => CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)]

  const decrypt = useCallback((plaintext: string) => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (!plaintext) {
      setDisplayValue("")
      return
    }

    targetRef.current = plaintext
    setIsDecrypting(true)

    const indicesToReveal = plaintext
      .split("")
      .map((char, i) => (char !== " " && char !== "\n" ? i : -1))
      .filter((i) => i !== -1)

    if (indicesToReveal.length === 0) {
      setDisplayValue(plaintext)
      setIsDecrypting(false)
      onCompleteRef.current?.()
      return
    }

    for (let i = indicesToReveal.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[indicesToReveal[i], indicesToReveal[j]] = [indicesToReveal[j], indicesToReveal[i]]
    }

    const revealed = new Set<number>()
    let revealCount = 0
    let currentDisplay = plaintext
      .split("")
      .map((char) => (char === " " || char === "\n" ? char : getRandomChar()))

    setDisplayValue(currentDisplay.join(""))

    const startedAt = Date.now()
    const frameInterval = 30

    timerRef.current = setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / Math.max(duration, 1))
      const targetRevealCount = Math.floor(progress * indicesToReveal.length)

      while (revealCount < targetRevealCount && revealCount < indicesToReveal.length) {
        const indexToReveal = indicesToReveal[revealCount]
        revealed.add(indexToReveal)
        currentDisplay[indexToReveal] = plaintext[indexToReveal]
        revealCount++
      }

      currentDisplay = currentDisplay.map((char, i) => {
        if (plaintext[i] === " " || plaintext[i] === "\n" || revealed.has(i)) return char
        return getRandomChar()
      })

      if (progress >= 1) {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setDisplayValue(plaintext)
        setIsDecrypting(false)
        onCompleteRef.current?.()
        return
      }

      setDisplayValue(currentDisplay.join(""))
    }, frameInterval)
  }, [duration])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const reset = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setDisplayValue("")
    setIsDecrypting(false)
    targetRef.current = ""
  }, [])

  return {
    displayValue,
    isDecrypting,
    decrypt,
    reset,
  }
}
