export default defineEventHandler(async (event) => {
  const user = event.context.appUser

  return {
    user,
  }
})
