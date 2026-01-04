<script setup lang="ts">
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useCollection, useFirestore } from 'vuefire'

const db = useFirestore()
const router = useRouter()
const sessionUser = useSessionUser()

const tripsQuery = computed(() => {
  if (!sessionUser.value?.uid)
    return null
  return query(
    collection(db, 'trips'),
    where('userId', '==', sessionUser.value.uid),
    orderBy('createdAt', 'desc'),
    limit(1),
  )
})

// Client-only to avoid SSR permission issues
const trips = import.meta.client
  ? useCollection(tripsQuery)
  : ref([])

watch(trips, (tripsList) => {
  if (tripsList.length === 0) {
    router.push('/trips/new')
  }
  else if (tripsList.length > 0) {
    router.push(`/trips/${tripsList[0].id}`)
  }
}, { immediate: true })
</script>

<template>
  <div class="flex items-center justify-center h-screen">
    <icon name="lucide:loader-circle" class="text-indigo-700 animate-spin -mt-20" size="40" />
  </div>
</template>
