// server/api/sitemap.ts
import admin from 'firebase-admin'

if (process.env.NODE_ENV === 'development') {
  admin.initializeApp()
}
else {
  const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  })
}

async function getDiaryUrls() {
  console.log('getDiaryUrls')
  try {
    const db = admin.firestore()
    const snapshot = await db.collection('diaries')
      .where('published', '==', true)
      .orderBy('entryDate', 'desc')
      .get()

    const diaryUrls = snapshot.docs.map((doc) => {
      return {
        loc: `/diaries/${doc.id}`,
        lastmod: doc.data().updated.toDate(),
      }
    })

    return diaryUrls
  }
  catch (error) {
    console.error('Failed to fetch diary URLs:', error)
    // Handle the error appropriately
    // This could be returning an error message, an empty array, etc., depending on your application's needs
    return []
  }
}

async function getStoryUrls() {
  console.log('getStoryUrls')
  try {
    const db = admin.firestore()
    const snapshot = await db.collection('stories')
      .where('published', '==', true)
      .orderBy('updated', 'desc')
      .get()

    const storyUrls = snapshot.docs.map((doc) => {
      return {
        loc: `/stories/${doc.id}`,
        lastmod: doc.data().updated.toDate(),
      }
    })

    return storyUrls
  }
  catch (error) {
    console.error('Failed to fetch story URLs:', error)
    // Handle the error appropriately
    // This could be returning an error message, an empty array, etc., depending on your application's needs
    return []
  }
}

async function getTopicUrls() {
  console.log('getTopicUrls')
  try {
    const db = admin.firestore()
    const snapshot = await db.collection('topics')
      .orderBy('updated', 'desc')
      .get()

    const topicUrls = snapshot.docs.map((doc) => {
      return {
        loc: `/topics/${doc.id}`,
        lastmod: doc.data().updated.toDate(),
      }
    })

    return topicUrls
  }
  catch (error) {
    console.error('Failed to fetch topic URLs:', error)
    // Handle the error appropriately
    // This could be returning an error message, an empty array, etc., depending on your application's needs
    return []
  }
}

export default defineEventHandler(async () => {
  const diaryUrls = await getDiaryUrls()
  const storyUrls = await getStoryUrls()
  const topicUrls = await getTopicUrls()

  console.log('diaryUrls:', diaryUrls)
  console.log('storyUrls:', storyUrls)
  console.log('topicUrls:', topicUrls)

  return [
    ...diaryUrls,
    ...storyUrls,
    ...topicUrls,
  ]
})
