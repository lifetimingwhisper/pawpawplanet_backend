const { Not, In } = require('typeorm')
const { dataSource } = require('../db/data-source')
const validation = require('../utils/validation')

// === api/patchOrderStatus related ===
function checkPermission(role, action) {
  // 驗證 role 是否有效
  if (!USER_ROLES[role.toUpperCase()]) {
    return { status: 'failed', statusCode: 400, message: `無效的角色: '${role}'` }
  }

  // 驗證 action 是否為支援動作
  if (!Object.values(ORDER_ACTIONS).includes(action)) {
    return { status: 'failed', statusCode: 405, message: `不支援的動作: '${action}'` }
  }

  // 檢查角色是否有權限執行該動作
  if (!permissions[role]?.includes(action)) {
    return { status: 'failed', statusCode: 403, message: `未經授權：您的角色 (${role}) 沒有執行 '${action}' 操作的權限` }
  }

  return { status: 'success', statusCode: 200, message: '成功' }
}

async function acceptOrder(userId, orderId) {
  const queryRunner = dataSource.createQueryRunner()

  try {
    await queryRunner.connect()
    await queryRunner.startTransaction()
    
    const freelancer = await queryRunner.manager.getRepository('Freelancer').findOne({ where: { user_id: userId } })
    const orderRepo = queryRunner.manager.getRepository('Order')
    const order = await orderRepo.findOne({ where: { id: orderId } })

    if (!freelancer || !order) {
      await queryRunner.rollbackTransaction()
      return { statusCode: 400, status: 'failed', message: '無法存取訂單' }
    }
    if (order.freelancer_id !== freelancer.id) {
      await queryRunner.rollbackTransaction()
      return { statusCode: 400, status: 'failed', message: '無法存取訂單，不是您的訂單' }
    }
    if (order.status !== ORDER_STATUS.PENDING) {
      await queryRunner.rollbackTransaction()
      return { statusCode: 422, status: 'failed', message: '無法接受預約，訂單狀態已改變' }
    }

    const otherOrdersOnSameDate = await orderRepo
      .find({
        where: {
          freelancer_id: freelancer.id,
          id: Not(order.id),
          service_date: order.service_date,
          status: In([ORDER_STATUS.PENDING, ORDER_STATUS.PAID]),
        }
      })

    const pendingOrders = otherOrdersOnSameDate.filter(order => order.status === ORDER_STATUS.PENDING)
    const paidOrders = otherOrdersOnSameDate.filter(order => order.status === ORDER_STATUS.PAID)

    if (!validation.isUndefined(paidOrders) && paidOrders.length > 0) {
      await queryRunner.rollbackTransaction()
      return { statusCode: 400, status: 'failed', message: '無法接受預約，您當天已有預約' }
    }

    // 調整訂單狀態  
    order.status = ORDER_STATUS.ACCEPTED
    if (!validation.isUndefined(pendingOrders) && pendingOrders.length > 0) {
      pendingOrders.forEach(order => {
        order.status = ORDER_STATUS.REJECTED
        order.did_freelancer_close_the_order = true
      })
    }

    const orders = (!pendingOrders || pendingOrders.length === 0) ? [order] : [{...order}, ...pendingOrders]
    await orderRepo.save(orders)

    await queryRunner.commitTransaction()
    return {
      statusCode: 200,
      status: 'success',
      message: '成功接受預約',
      data: {
        order_status: ORDER_STATUS.ACCEPTED,
        target_tag: {
          value: ORDER_CAT_TAG.ACCEPTED.value,
          caption: ORDER_CAT_TAG.ACCEPTED.captions[USER_ROLES.FREELANCER]
        }
      }}
  } catch (error) {
    await queryRunner.rollbackTransaction()
    console.error('acceptOrder 發生錯誤:', error)
    return {
      status: 'error',
      statusCode: 500,
      message: `接受預約時發生錯誤: ${error.message}`,
      errorDetails: error,
    }
  } finally {
    await queryRunner.release()
  }
}

async function rejectOrder(userId, orderId) {
  try {
    const freelancer = await dataSource.getRepository('Freelancer').findOne({ where: { user_id: userId } })
    const orderRepo = dataSource.getRepository('Order')
    const order = await orderRepo.findOne({ where: { id: orderId } })

    if (validation.isUndefined(freelancer) || validation.isUndefined(order)) {
      return { statusCode: 400, status: 'failed', message: '無法存取訂單' }
    }
    if (order.freelancer_id !== freelancer.id) {
      return { statusCode: 400, status: 'failed', message: '無法存取訂單，不是您的訂單' }
    }
    if (order.status !== ORDER_STATUS.PENDING) {
      return { statusCode: 422, status: 'failed', message: '無法拒絕預約，訂單狀態已改變' }
    }

    // 調整訂單狀態  
    order.status = ORDER_STATUS.REJECTED
    order.did_freelancer_close_the_order = true
    await orderRepo.save(order)
   
    return {
      statusCode: 200,
      status: 'success',
      message: '成功接受預約',
      data: {
        order_status: ORDER_STATUS.REJECTED,
        target_tag: {
          value: ORDER_CAT_TAG.CLOSE.value,
          caption: ORDER_CAT_TAG.CLOSE.captions[USER_ROLES.FREELANCER]
        }
      }}
  } catch (error) {
    console.error('rejectOrder 發生錯誤:', error)
    return {
      status: 'error',
      statusCode: 500,
      message: `拒絕預約時發生錯誤: ${error.message}`,
      errorDetails: error
    }
  }
}

async function cancelOrder(userId, orderId) {
  try {
    const owner = await dataSource.getRepository('User').findOne({ where: { id: userId } })
    const orderRepo = dataSource.getRepository('Order')
    const order = await orderRepo.findOne({ where: { id: orderId } })

    if (validation.isUndefined(owner) || validation.isUndefined(order)) {
      return { statusCode: 400, status: 'failed', message: '無法存取訂單' }
    }
    if (!order.owner_id || order.owner_id !== owner.id) {
      return { statusCode: 400, status: 'failed', message: '無法存取訂單，不是您的訂單' }
    }
    if (order.did_owner_close_the_order) {
      return { statusCode: 422, status: 'failed', message: '無法取消預約，訂單已結案' }
    }
  
    // 調整訂單狀態  
    order.status = ORDER_STATUS.CANCELLED
    order.did_owner_close_the_order = true
    await orderRepo.save(order) 

    return {
      statusCode: 200,
      status: 'success',
      message: '成功接受預約',
      data: {
        order_status: ORDER_STATUS.CANCELLED,
        target_tag: {
          value: ORDER_CAT_TAG.CLOSE.value,
          caption: ORDER_CAT_TAG.CLOSE.captions[USER_ROLES.OWNER]
        }
      }}    
  } catch (error) {
    return {
      status: 'error',
      statusCode: 500,
      message: `取消預約時發生錯誤: ${error.message}`,
      errorDetails: error
    }
  }
}

async function ownerCloseOrder(userId, orderId) {
  try {
    const owner = await dataSource.getRepository('User').findOne({ where: { id: userId } })
    const orderRepo = dataSource.getRepository('Order')
    const order = await orderRepo.findOne({ where: { id: orderId } })

    if (validation.isNotValidObject(owner) || validation.isNotValidObject(order)) {
      return { statusCode: 400, status: 'failed', message: '無法存取訂單' }
    }
    if (order.owner_id !== owner.id) {
      return { statusCode: 400, status: 'failed', message: '無法存取訂單，不是您的訂單' }
    }
    if (order.status !== ORDER_STATUS.REJECTED) {
      return { statusCode: 422, status: 'failed', message: `無法結案，訂單狀態為(${order.status})` }
    }
    
    // 調整訂單狀態  
    order.did_owner_close_the_order = true
    
    await orderRepo.save(order)
    return {
      statusCode: 200,
      status: 'success',
      message: '成功接受預約',
      data: {
        order_status: ORDER_STATUS.CLOSE,
        target_tag: {
          value: ORDER_CAT_TAG.CLOSE.value,
          caption: ORDER_CAT_TAG.CLOSE.captions[USER_ROLES.OWNER]
        }
      }}  
  } catch (error) {
    console.log('ownerCloseOrder error:', error)
    return {
      status: 'error',
      statusCode: 500,
      message: `結案時發生錯誤: ${error.message}`,
      errorDetails: error
    }
  }
}

async function freelancerCloseOrder(userId, orderId) {
  try {
    const freelancer = await dataSource.getRepository('Freelancer').findOne({ where: { user_id: userId } })
    const orderRepo = dataSource.getRepository('Order')
    const order = await orderRepo.findOne({ where: { id: orderId } })

    if (validation.isUndefined(freelancer) || validation.isUndefined(order)) {
      return { statusCode: 400, status: 'failed', message: '無法存取訂單' }
    }
    if (order.freelancer_id !== freelancer.id) {
      return { statusCode: 400, status: 'failed', message: '無法存取訂單，不是您的訂單' }
    }
    if (order.status !== ORDER_STATUS.CANCELLED && order.status !== ORDER_STATUS.EXPIRED) {
      return { statusCode: 422, status: 'failed', message: `無法結案，訂單狀態為(${order.status})` }
    }

    // 調整訂單狀態  
    order.did_freelancer_close_the_order = true

    await orderRepo.save(order)
    return {
      statusCode: 200,
      status: 'success',
      message: '成功接受預約',
      data: {
        order_status: ORDER_STATUS.CLOSE,
        target_tag: {
          value: ORDER_CAT_TAG.CLOSE.value,
          caption: ORDER_CAT_TAG.CLOSE.captions[USER_ROLES.FREELANCER]
        }
      }
    }  
  } catch (error) {
    console.log('freelancerCloseOrder error:', error)
    return {
      status: 'error',
      statusCode: 500,
      message: `結案時發生錯誤: ${error.message}`,
      errorDetails: error
    }
  }
}

// 更新 order & payment 並將當天其他訂單會 ”自動” 取消
async function payOrder(orderId, paymentData) { 
  const queryRunner = dataSource.createQueryRunner()

  try {
    await queryRunner.connect()
    await queryRunner.startTransaction()

    const orderRepo = queryRunner.manager.getRepository('Order')
    const order = await orderRepo.findOne({ where: { id: orderId } })

    if (!order) {
      await queryRunner.rollbackTransaction()
      return { statusCode: 400, status: 'failed', message: '無法存取訂單' }
    }

    if (order.status !== ORDER_STATUS.ACCEPTED) {
      await queryRunner.rollbackTransaction()
      return { statusCode: 422, status: 'failed', message: '無法為訂單付款，訂單狀態已改變' }
    }

    const otherOrdersOnSameDate = await orderRepo
      .find({
        where: {
          id: Not(order.id),
          service_date: order.service_date,
          status: In([ORDER_STATUS.PENDING, ORDER_STATUS.ACCEPTED, ORDER_STATUS.PAID]),
        }
      })

    const gonnaCancelledOrders = otherOrdersOnSameDate.filter(order => order.status === ORDER_STATUS.PENDING 
      || order.status === ORDER_STATUS.ACCEPTED)
    const paidOrders = otherOrdersOnSameDate.filter(order => order.status === ORDER_STATUS.PAID)

    if (!paidOrders && paidOrders.length > 0) {
      await queryRunner.rollbackTransaction()
      return { statusCode: 400, status: 'failed', message: '無法為訂單付款，您當天已有其他完成付款預約' }
    }

    // 調整訂單狀態  
    order.status = ORDER_STATUS.PAID
    order.payment.success = true
    // 利用 paymentData 調整 order.payment
    if (!gonnaCancelledOrders && gonnaCancelledOrders > 0) {
      gonnaCancelledOrders.forEach(order => {
        order.status = ORDER_STATUS.CANCELLED
        order.did_owner_close_the_order = true
      })
    }

    const orders = (!gonnaCancelledOrders || gonnaCancelledOrders.length === 0) ? [{...order}, ...gonnaCancelledOrders] : [order]
    await orderRepo.save(orders)

    await queryRunner.commitTransaction()
    return { statusCode: 200, status: 'success', message: '成功為訂單付款', data: { order_status: ORDER_STATUS.ACCEPTED } }

  } catch (error) {
    await queryRunner.rollbackTransaction()
    console.error('payOrder 發生錯誤:', error)
    return {
      status: 'error',
      statusCode: 500,
      message: `為訂單付款時發生錯誤: ${error.message}`,
      errorDetails: error,
    }
  } finally {
    await queryRunner.release()
  }
}

// === api/{role}/orders?tag={tag}&limit={limit}&page={page} related ===
async function freelancerGetOrders(userId, tag, limit, page) {
  try {
    const freelancer = await dataSource.getRepository('Freelancer').findOne({ where: { user_id: userId } })
    if (validation.isNotValidObject(freelancer)) {
      return { statusCode: 400, status: 'failed', message: '無法取得訂單：找不到保姆資料' }
    }

    const query = {
      ...prepareOrderQueryForTagByRole(tag, USER_ROLES.FREELANCER),
      freelancerId: freelancer.id,
      limit: limit,
      page: page
    }
    
    let queryResult = await getOrdersWithQuery(query)
    if (validation.isNotValidObject(queryResult)) {
      return { statusCode: 500, status: 'failed', message: '伺服器錯誤：getOrdersWithQuery returned no results' }
    } else if (validation.isNotSuccessStatusCode(queryResult.statusCode)) {
      return { statusCode: queryResult.statusCode, status: queryResult.status, message: queryResult.message }
    }
  
    if (queryResult.data.orders.length === 0) {
      return {
        status: queryResult.status,
        statusCode: queryResult.statusCode,
        message: queryResult.message,
        data: queryResult.data
      }
    }

    const total = queryResult.data.total
    const expandResult = await freelancerExpandOrders(queryResult.data.orders)
    if (validation.isNotValidObject(expandResult)) {
      return { statusCode: 500, status: 'failed', message: '伺服器錯誤：freelancerExpandOrders returned no results' }
    } else if (validation.isNotSuccessStatusCode(expandResult.statusCode)) {
      return { statusCode: expandResult.statusCode, status: expandResult.status, message: expandResult.message }
    }

    return {
      status: expandResult.status,
      statusCode: expandResult.statusCode,
      message: expandResult.message,
      data: {
        limit: limit,
        page: page,
        total: total,
        orders: expandResult.data
      }
    }
  } catch (error) {
    throw validation.generateError('error', `查詢指定標籤訂單時發生錯誤: ${error.message}`, error)
  }
}

async function ownerGetOrders(userId, tag, limit, page) {
  try {
    const query = {
      ...prepareOrderQueryForTagByRole(tag, USER_ROLES.OWNER),
      ownerId: userId,
      limit: limit,
      page: page
    }

    const queryResult = await getOrdersWithQuery(query)

    if (validation.isNotValidObject(queryResult)) {
      return { statusCode: 500, status: 'failed', message: '伺服器錯誤：getOrdersWithQuery returned no results' }
    } else if (validation.isNotSuccessStatusCode(queryResult.statusCode)) {
      return { statusCode: queryResult.statusCode, status: queryResult.status, message: queryResult.message }
    }

    if (queryResult.data.orders.length === 0) {
      return {
        status: queryResult.status,
        statusCode: queryResult.statusCode,
        message: queryResult.message,
        data: queryResult.data
      }
    }

    const total = queryResult.data.total
    const expandResult = await ownerExpandOrders(queryResult.data.orders)
    if (validation.isNotValidObject(expandResult)) {
      return { statusCode: 500, status: 'failed', message: '伺服器錯誤：ownerExpandOrders returned no results' }
    } else if (validation.isNotSuccessStatusCode(expandResult.statusCode)) {
      return { statusCode: expandResult.statusCode, status: expandResult.status, message: expandResult.message }
    }

    return {
      status: expandResult.status,
      statusCode: expandResult.statusCode,
      message: expandResult.message,
      data: {
        limit: limit,
        page: page,
        total: total,
        orders: expandResult.data
      }
    }      
  } catch (error) {
    throw validation.generateError('error', `查詢指定標籤訂單時發生錯誤: ${error.message}`, error)
  }
}

function prepareOrderQueryForTagByRole(tag, role) {
  const query = { status: [] }
  if (role === USER_ROLES.FREELANCER) {
    switch (tag) {
    case ORDER_CAT_TAG.PENDING.value:
      query.status.push(ORDER_STATUS.PENDING)
      break
    case ORDER_CAT_TAG.ACCEPTED.value:
      query.status.push(ORDER_STATUS.ACCEPTED)
      break
    case ORDER_CAT_TAG.PAID.value:
      query.status.push(ORDER_STATUS.PAID)
      break
    case ORDER_CAT_TAG.LATEST_RESPONSE.value:
      query.status = query.status.concat([ORDER_STATUS.CANCELLED, ORDER_STATUS.EXPIRED])
      query.didFreelancerCloseTheOrder = false
      break
    case ORDER_CAT_TAG.CLOSE.value:
      query.didFreelancerCloseTheOrder = true
      // query.status = query.status.concat([ORDER_STATUS.CANCELLED, ORDER_STATUS.EXPIRED, ORDER_STATUS.COMPLETED])
      break
    default:
      console.log('should not reach the default case')
    }
  } else if (role === USER_ROLES.OWNER) {
    switch (tag) {
    case ORDER_CAT_TAG.PENDING.value:
      query.status.push(ORDER_STATUS.PENDING)
      break
    case ORDER_CAT_TAG.ACCEPTED.value:
      query.status.push(ORDER_STATUS.ACCEPTED)
      break
    case ORDER_CAT_TAG.PAID.value:
      query.status.push(ORDER_STATUS.PAID)
      break
    case ORDER_CAT_TAG.LATEST_RESPONSE.value:
      query.status.push(ORDER_STATUS.REJECTED)
      query.didOwnerCloseTheOrder = false
      break
    case ORDER_CAT_TAG.CLOSE.value:
      query.didOwnerCloseTheOrder = true
      // query.status = query.status.concat([ORDER_STATUS.CANCELLED, ORDER_STATUS.EXPIRED, ORDER_STATUS.COMPLETED])
      break
    default:
      console.log('should not reach the default case')
    }
  }

  return query
}

async function getOrdersWithQuery(query) {
  try {
    const orderRepo = dataSource.getRepository('Order')
    const queryBuilder = orderRepo.createQueryBuilder('order')

    // 飼主或保姆 id
    if (query.freelancerId) {
      queryBuilder.andWhere('order.freelancer_id = :freelancerId', { freelancerId: query.freelancerId })
    } else if (query.ownerId) {
      queryBuilder.andWhere('order.owner_id = :ownerId', { ownerId: query.ownerId })
    } else {
      return { statusCode: 400, status: 'failed', message: '無法取得訂單：查詢條件缺少會員資料' }
    }

    // 訂單狀態
    if (query.status.length > 0) {
      queryBuilder.andWhere('order.status IN (:...status)', { status: query.status })
    }

    // 保姆是否已結案
    if (query.didFreelancerCloseTheOrder !== undefined) {
      queryBuilder.andWhere('order.did_freelancer_close_the_order = :didFreelancerCloseTheOrder', {
        didFreelancerCloseTheOrder: query.didFreelancerCloseTheOrder,
      })
    }

    // 飼主是否已結案
    if (query.didOwnerCloseTheOrder !== undefined) {
      queryBuilder.andWhere('order.did_owner_close_the_order = :didOwnerCloseTheOrder', {
        didOwnerCloseTheOrder: query.didOwnerCloseTheOrder,
      })
    }

    // 複製 queryBuilder 以進行計數查詢，避免影響原始查詢
    const countQueryBuilder = queryBuilder.clone()
    const total = await countQueryBuilder.getCount()

    queryBuilder.take(query.limit) // 設定每頁筆數
    queryBuilder.skip((query.page - 1) * query.limit) // 設定要跳過的筆數

    const orders = await queryBuilder.getMany()
    
    return {
      status: 'success',
      statusCode: 200,
      message: '成功',
      data: {
        limit: query.limit,
        page: query.page,
        total: total,
        orders: orders
      }
    }
  } catch (error) {
    throw validation.generateError('error', `查詢指定標籤訂單時發生錯誤: ${error.message}`, error)
  }
}

function expandOrder(order, user, pet, service, review) {
  return {
    user: {
      name: user.name,
      phone: user.phone,
      city: user.city,
      area: user.area,
      description: user.description,
      avatar: user.avatar,
    },
    pet: {
      name: pet.name,
      species_id: pet.species_id,
      size: pet.size_id,
      birthday: pet.birthday,
      gender: pet.gender,
      personality_description: pet.personality_description,
      avatar: pet.avatar
    },
    service: {
      name: service.name,
      service_type_id: service.service_type_id,
      price: service.price,
      price_unit: service.price_unit,
      title: service.title
    },
    order: {
      id: order.id,
      service_date: order.service_date,
      price: order.price,
      note: order.note,
      status: order.status,
      did_freelancer_close_the_order: order.did_freelancer_close_the_order,
      did_owner_close_the_order: order.did_owner_close_the_order,
      created_at: order.created_at,
      updated_at: order.updated_at,
    },
    review: review,
  }
}

async function freelancerExpandOrders(orders) {
  try {
    const orderRepo = dataSource.getRepository('Order')
    const petRepo = dataSource.getRepository('Pet')
    const reviewRepo = dataSource.getRepository('Review')

    const petIds = orders.map(order => order.pet_id)
    const orderIds = orders.map(order => order.id)

    const [pets, reviews, expandedOrders] = await Promise.all([
      petRepo.findBy({ id: In(petIds) }),
      reviewRepo.findBy({ order_id: In(orderIds) }),
      orderRepo
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.owner', 'owner')
        .leftJoinAndSelect('order.service', 'service')
        .where('order.id IN (:...ids)', { ids: orderIds })
        .getMany()
    ])

    const petMap = new Map(pets.map(pet => [pet.id, pet]))
    const reviewMap = new Map(reviews.filter(r => !validation.isNotValidObject(r))
      .map(review => [review.order_id, review]))

    const data = expandedOrders.map(order => {
      const pet = petMap.get(order.pet_id)
      if (validation.isNotValidObject(pet)) {
        return { statusCode: 500, status: 'failed', message: '伺服器錯誤：`Order ${order} 關聯資料有誤`' }
      }

      const review = reviewMap.get(order.id) ?? {}
      const expandedOrder = expandOrder(order, order.owner, pet, order.service, review)
      const { user, ...rest } = expandedOrder
      
      return { owner: user, ...rest }
    })
  
    return { statusCode: 200, status: 'success', message: '成功', data: data }
  } catch (error) {
    throw validation.generateError('error', error.message, error)
  }
}

async function ownerExpandOrders(orders) {
  try {
    const orderRepo = dataSource.getRepository('Order')
    const petRepo = dataSource.getRepository('Pet')
    const reviewRepo = dataSource.getRepository('Review')
    const freelancerRepo = dataSource.getRepository('Freelancer')
    const userRepo = dataSource.getRepository('User')

    const petIds = orders.map(order => order.pet_id)
    const orderIds = orders.map(order => order.id)
    const freelancerIds = orders.map(order => order.freelancer_id)

    const [pets, reviews, freelancers, expandedOrders] = await Promise.all([
      petRepo.findBy({ id: In(petIds) }),
      reviewRepo.findBy({ order_id: In(orderIds) }),
      freelancerRepo.findBy({ id: In(freelancerIds) }),
      orderRepo
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.freelancer', 'freelancer')
        .leftJoinAndSelect('order.service', 'service')
        .where('order.id IN (:...ids)', { ids: orderIds })
        .getMany()
    ])

    const petMap = new Map(pets.map(pet => [pet.id, pet]))
    const reviewMap = new Map(reviews.filter(r => !validation.isNotValidObject(r))
      .map(review => [review.order_id, review]))

    const userIds = freelancers.map( freelancer => freelancer.user_id)
    const users = await userRepo.findBy({ id: In(userIds)})
    const userMap = new Map(users.map(user => [user.id, user]))
    const freelancerMap = new Map(
      freelancers.map(freelancer => [freelancer.id, userMap.get(freelancer.user_id)]))

    const data = expandedOrders.map(order => {
      const pet = petMap.get(order.pet_id)
      if (validation.isNotValidObject(pet)) {
        return { statusCode: 500, status: 'failed', message: '伺服器錯誤：`Order ${order} 關聯資料有誤`' }
      }

      const freelancer = freelancerMap.get(order.freelancer_id)
      if (validation.isNotValidObject(freelancer)) {
        return { statusCode: 500, status: 'failed', message: '伺服器錯誤：`Order ${order} 關聯資料有誤`' }
      }

      const review = reviewMap.get(order.id) ?? {}
      
      const expandedOrder = expandOrder(order, freelancer, pet, order.service, review)
      const { user, ...rest } = expandedOrder
      return { freelancer: user, ...rest }
    })

    return { statusCode: 200, status: 'success', message: '成功', data: data }
  } catch (error) {
    throw validation.generateError('error', error.message, error)
  }
}

// === constants ===
const USER_ROLES = {
  OWNER: 'owner',
  FREELANCER: 'freelancer',
}

const ORDER_ACTIONS = {
  ACCEPT: 'accept',
  REJECT: 'reject',
  CANCEL: 'cancel',
  CLOSE: 'close',
  /*'request' */
  /*'pay'*/
}

const permissions = {
  [USER_ROLES.OWNER]: [ORDER_ACTIONS.CANCEL, ORDER_ACTIONS.CLOSE],
  [USER_ROLES.FREELANCER]: [ORDER_ACTIONS.ACCEPT, ORDER_ACTIONS.REJECT, ORDER_ACTIONS.CLOSE],
}

const ORDER_STATUS = { // 0 pending, 1 accepted, 2 paid, 3 rejected, 4 cancelled, 5 expired 6 completed
  PENDING: 0,    // 飼主請求預約
  ACCEPTED: 1,     // 保姆接受預約
  PAID: 2,       // 飼主付款
  REJECTED: 3,   // 保姆拒絕預約
  CANCELLED: 4,  // 飼主取消預約
  EXPIRED_NO_PAY: 5,    // 飼主逾期未付款
  EXPIRED_NO_RESPONSE: 6, // 保姆逾期未回覆
  COMPLETED: 7  // 訂單完成
}

const ORDER_CAT_TAG = {
  PENDING: {
    value: 0,
    captions: {
      [USER_ROLES.OWNER]: '等待回覆',
      [USER_ROLES.FREELANCER]: '等待接受'
    }
  },
  ACCEPTED: {
    value: 1,
    captions: {
      [USER_ROLES.OWNER]: '預約成功付款',
      [USER_ROLES.FREELANCER]: '等待付款'
    }
  },
  PAID: {
    value: 2,
    captions: {
      [USER_ROLES.OWNER]: '即將執行',
      [USER_ROLES.FREELANCER]: '即將執行'
    }
  },
  LATEST_RESPONSE: {
    value: 3,
    captions: {
      [USER_ROLES.OWNER]: '最新回應',
      [USER_ROLES.FREELANCER]: '最新回應'
    }
  }, // 飼主 “”， 保姆 “最新回應”
  CLOSE: {
    value: 4,
    captions: {
      [USER_ROLES.OWNER]: '結案',
      [USER_ROLES.FREELANCER]: '結案'
    }
  }
}

// === exports ===
module.exports = {
  checkPermission,

  acceptOrder,
  rejectOrder,
  cancelOrder,
  ownerCloseOrder,
  freelancerCloseOrder,
  payOrder,

  freelancerGetOrders,
  ownerGetOrders,

  freelancerExpandOrders,
  ownerExpandOrders,
  
  USER_ROLES,
  ORDER_CAT_TAG,
  ORDER_STATUS
}