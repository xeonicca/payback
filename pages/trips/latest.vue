<script setup lang="ts">
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useCollection, useFirestore, usePendingPromises } from 'vuefire'

const db = useFirestore()
const router = useRouter()

const tripsCollection = collection(db, 'trips')
const tripsQuery = query(tripsCollection, orderBy('createdAt', 'desc'), limit(1))
const trips = useCollection(tripsQuery, { ssrKey: 'find-latest-trip' })
await usePendingPromises()

onMounted(() => {
  if (trips.value.length === 0) {
    router.push('/trips/new')
  }
  else {
    router.push(`/trips/${trips.value[0].id}`)
  }
})
</script>

<template>
  <div>
    <h1>Latest Trips</h1>
  </div>
</template>
